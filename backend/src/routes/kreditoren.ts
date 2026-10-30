// Kreditoren-Belege: Liste, Detail, Erfassen → Verbuchen (nutzt die Engine).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { postKreditorenBeleg } from '../accounting/kreditoren.js';
import { AccountingError } from '../accounting/types.js';

interface PositionInput {
  konto_nr: string;
  bezeichnung?: string;
  mwst_code: string;
  mwst_satz?: number;
  betrag_netto: number | string;
  betrag_mwst: number | string;
  betrag_brutto: number | string;
}

interface BelegInput {
  lieferant_id?: string;
  beleg_nr?: string;
  lieferant_beleg_nr?: string;
  belegdatum?: string;
  faelligkeit?: string;
  buchungsdatum?: string;
  waehrung?: string;
  belegtyp?: 'rechnung' | 'gutschrift';
  belegtext?: string;
  notiz?: string;
  positionen?: PositionInput[];
  verbuchen?: boolean;
}

const num = (v: number | string): number => (typeof v === 'number' ? v : Number(v));
const f2 = (v: number): string => v.toFixed(2);

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function kreditorenRoutes(app: FastifyInstance): Promise<void> {
  // ── Liste ──
  app.get<{ Params: { id: string }; Querystring: { status?: string; verbucht?: string } }>(
    '/mandanten/:id/kreditoren-belege',
    async (req) => {
      const where = ['b.mandant_id = :id'];
      const params: Record<string, string | number | boolean | null | undefined> = { id: req.params.id };
      if (req.query.status) { where.push('b.status = :status'); params.status = req.query.status; }
      if (req.query.verbucht === '0') where.push('b.verbucht = FALSE');
      if (req.query.verbucht === '1') where.push('b.verbucht = TRUE');
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT b.id, b.beleg_nr, b.lieferant_id, l.name AS lieferant_name, b.belegdatum, b.faelligkeit,
                b.waehrung, b.betrag_netto, b.betrag_mwst, b.betrag_brutto, b.status, b.belegtyp, b.verbucht
           FROM fibu_kreditoren_belege b
           JOIN fibu_lieferanten l ON l.id = b.lieferant_id
          WHERE ${where.join(' AND ')}
          ORDER BY b.belegdatum DESC, b.beleg_nr DESC`,
        params,
      );
      return rows;
    },
  );

  // ── Detail (Kopf + Positionen + Hauptbuch-Zeilen) ──
  app.get<{ Params: { id: string } }>('/kreditoren-belege/:id', async (req, reply) => {
    const [belege] = await pool.query<RowDataPacket[]>(
      `SELECT b.*, l.name AS lieferant_name
         FROM fibu_kreditoren_belege b
         JOIN fibu_lieferanten l ON l.id = b.lieferant_id
        WHERE b.id = :id`,
      { id: req.params.id },
    );
    if (belege.length === 0) return reply.code(404).send({ error: 'Beleg nicht gefunden' });
    const [positionen] = await pool.query<RowDataPacket[]>(
      `SELECT position, konto_nr, bezeichnung, mwst_code, mwst_satz, betrag_netto, betrag_mwst, betrag_brutto
         FROM fibu_kreditoren_positionen WHERE beleg_id = :id ORDER BY position`,
      { id: req.params.id },
    );
    const [buchungen] = await pool.query<RowDataPacket[]>(
      `SELECT buchungs_nr, buchungsdatum, konto_soll, konto_haben, betrag, mwst_code, mwst_betrag, text
         FROM fibu_buchungen WHERE quelle = 'kreditoren' AND quelle_id = :id
        ORDER BY buchungs_nr`,
      { id: req.params.id },
    );
    return { ...belege[0], positionen, buchungen };
  });

  // ── Erfassen (+ optional sofort verbuchen) ──
  app.post<{ Params: { id: string }; Body: BelegInput }>(
    '/mandanten/:id/kreditoren-belege',
    async (req, reply) => {
      const mandantId = req.params.id;
      const b = req.body ?? {};
      if (!b.lieferant_id) return reply.code(400).send({ error: 'lieferant_id ist erforderlich' });
      if (!b.belegdatum) return reply.code(400).send({ error: 'belegdatum ist erforderlich' });
      if (!b.positionen || b.positionen.length === 0) return reply.code(400).send({ error: 'mindestens eine Position erforderlich' });

      const conn = await pool.getConnection();
      let belegId = '';
      try {
        await conn.beginTransaction();

        // Lieferant prüfen (gehört zum Mandanten?) + Zahlungsziel lesen.
        const [lief] = await conn.query<RowDataPacket[]>(
          `SELECT zahlungsbedingung_tage FROM fibu_lieferanten WHERE id = :lid AND mandant_id = :mid`,
          { lid: b.lieferant_id, mid: mandantId },
        );
        if (lief.length === 0) throw new AccountingError('Lieferant gehört nicht zu diesem Mandanten');
        const zielTage = Number(lief[0]!.zahlungsbedingung_tage ?? 30);

        const belegNr = b.beleg_nr?.trim() || (await nextBelegNr(conn, mandantId));
        const faelligkeit = b.faelligkeit ?? addDays(b.belegdatum, zielTage);

        // Kopfsummen aus den Positionen.
        const sumNetto = b.positionen.reduce((s, p) => s + num(p.betrag_netto), 0);
        const sumMwst = b.positionen.reduce((s, p) => s + num(p.betrag_mwst), 0);
        const sumBrutto = b.positionen.reduce((s, p) => s + num(p.betrag_brutto), 0);

        belegId = randomUUID();
        await conn.query(
          `INSERT INTO fibu_kreditoren_belege
             (id, mandant_id, beleg_nr, lieferant_id, lieferant_beleg_nr, belegdatum, faelligkeit,
              buchungsdatum, waehrung, belegtyp, belegtext, notiz, betrag_netto, betrag_mwst, betrag_brutto)
           VALUES
             (:id, :mid, :beleg_nr, :lid, :lbnr, :belegdatum, :faelligkeit,
              :buchungsdatum, :waehrung, :belegtyp, :belegtext, :notiz, :netto, :mwst, :brutto)`,
          {
            id: belegId, mid: mandantId, beleg_nr: belegNr, lid: b.lieferant_id,
            lbnr: b.lieferant_beleg_nr ?? null, belegdatum: b.belegdatum, faelligkeit,
            buchungsdatum: b.buchungsdatum ?? null, waehrung: b.waehrung ?? 'CHF',
            belegtyp: b.belegtyp ?? 'rechnung', belegtext: b.belegtext ?? null, notiz: b.notiz ?? null,
            netto: f2(sumNetto), mwst: f2(sumMwst), brutto: f2(sumBrutto),
          },
        );

        let i = 0;
        for (const p of b.positionen) {
          i += 1;
          await conn.query(
            `INSERT INTO fibu_kreditoren_positionen
               (mandant_id, beleg_id, position, konto_nr, bezeichnung, mwst_code, mwst_satz,
                betrag_netto, betrag_mwst, betrag_brutto)
             VALUES (:mid, :bid, :pos, :konto, :bez, :code, :satz, :netto, :mwst, :brutto)`,
            {
              mid: mandantId, bid: belegId, pos: i, konto: p.konto_nr, bez: p.bezeichnung ?? null,
              code: p.mwst_code, satz: p.mwst_satz ?? 0,
              netto: f2(num(p.betrag_netto)), mwst: f2(num(p.betrag_mwst)), brutto: f2(num(p.betrag_brutto)),
            },
          );
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        const code = err instanceof AccountingError ? 400 : 500;
        return reply.code(code).send({ error: (err as Error).message });
      } finally {
        conn.release();
      }

      // Verbuchen (Default an) über die Engine — eigene Transaktion.
      if (b.verbuchen !== false) {
        try {
          await postKreditorenBeleg(belegId);
        } catch (err) {
          const code = err instanceof AccountingError ? 400 : 500;
          return reply.code(code).send({ error: `Erfasst, aber Verbuchung fehlgeschlagen: ${(err as Error).message}`, beleg_id: belegId });
        }
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT b.*, l.name AS lieferant_name
           FROM fibu_kreditoren_belege b JOIN fibu_lieferanten l ON l.id = b.lieferant_id
          WHERE b.id = :id`,
        { id: belegId },
      );
      return reply.code(201).send(rows[0]);
    },
  );
}

/** Fortlaufende Belegnummer KR-JJJJ-NNNNN innerhalb der Transaktion. */
async function nextBelegNr(conn: PoolConnection, mandantId: string): Promise<string> {
  const jahr = new Date().getFullYear();
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT beleg_nr FROM fibu_kreditoren_belege
      WHERE mandant_id = :mid AND beleg_nr LIKE :prefix
      ORDER BY beleg_nr DESC LIMIT 1 FOR UPDATE`,
    { mid: mandantId, prefix: `KR-${jahr}-%` },
  );
  const seq = rows.length > 0 ? Number(String(rows[0]!.beleg_nr).split('-')[2]) + 1 : 1;
  return `KR-${jahr}-${String(seq).padStart(5, '0')}`;
}

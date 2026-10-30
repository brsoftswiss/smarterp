// Stammdaten: Kontenplan, MwSt-Codes und Lieferanten (Liste/Anlegen/Bearbeiten).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';

interface LieferantInput {
  nr?: string;
  name?: string;
  uid?: string;
  adresse?: string;
  plz?: string;
  ort?: string;
  land?: string;
  iban?: string;
  bank_name?: string;
  zahlungsbedingung_tage?: number;
  skonto_prozent?: number;
  skonto_tage?: number;
  standard_konto_nr?: string;
  mwst_code?: string;
  waehrung?: string;
  notiz?: string;
  aktiv?: boolean;
}

const LIEFERANT_FIELDS = `id, mandant_id, nr, name, uid, adresse, plz, ort, land, iban, bank_name,
  zahlungsbedingung_tage, skonto_prozent, skonto_tage, standard_konto_nr, mwst_code, waehrung, notiz, aktiv,
  created_at, updated_at`;

export async function stammdatenRoutes(app: FastifyInstance): Promise<void> {
  // ── Kontenplan ──
  app.get<{ Params: { id: string }; Querystring: { aktiv?: string; typ?: string } }>(
    '/mandanten/:id/konten',
    async (req) => {
      const where = ['mandant_id = :id'];
      const params: Record<string, string | number | boolean | null | undefined> = { id: req.params.id };
      if (req.query.aktiv === '1') where.push('aktiv = TRUE');
      if (req.query.typ) { where.push('konto_typ = :typ'); params.typ = req.query.typ; }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, konto_nr, bezeichnung, konto_typ, mwst_code, aktiv, waehrung
           FROM fibu_konten
          WHERE ${where.join(' AND ')}
          ORDER BY konto_nr`,
        params,
      );
      return rows;
    },
  );

  // ── MwSt-Codes ──
  app.get<{ Params: { id: string }; Querystring: { aktiv?: string; typ?: string } }>(
    '/mandanten/:id/mwst-codes',
    async (req) => {
      const where = ['mandant_id = :id'];
      const params: Record<string, string | number | boolean | null | undefined> = { id: req.params.id };
      if (req.query.aktiv === '1') where.push('aktiv = TRUE');
      if (req.query.typ) { where.push('typ = :typ'); params.typ = req.query.typ; }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, code, bezeichnung, satz, typ, konto_vorsteuer, konto_umsatz, aktiv, sortierung
           FROM fibu_mwst_codes
          WHERE ${where.join(' AND ')}
          ORDER BY sortierung, code`,
        params,
      );
      return rows;
    },
  );

  // ── Lieferanten: Liste ──
  app.get<{ Params: { id: string }; Querystring: { aktiv?: string; suche?: string } }>(
    '/mandanten/:id/lieferanten',
    async (req) => {
      const where = ['mandant_id = :id'];
      const params: Record<string, string | number | boolean | null | undefined> = { id: req.params.id };
      if (req.query.aktiv === '1') where.push('aktiv = TRUE');
      if (req.query.suche) { where.push('(name LIKE :s OR nr LIKE :s)'); params.s = `%${req.query.suche}%`; }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${LIEFERANT_FIELDS} FROM fibu_lieferanten
          WHERE ${where.join(' AND ')}
          ORDER BY name`,
        params,
      );
      return rows;
    },
  );

  // ── Lieferant: Anlegen ──
  app.post<{ Params: { id: string }; Body: LieferantInput }>(
    '/mandanten/:id/lieferanten',
    async (req, reply) => {
      const mandantId = req.params.id;
      const b = req.body ?? {};
      if (!b.name || b.name.trim() === '') return reply.code(400).send({ error: 'name ist erforderlich' });

      // Lieferantennummer automatisch vergeben, falls nicht gesetzt.
      let nr = b.nr?.trim();
      if (!nr) {
        const [cnt] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM fibu_lieferanten WHERE mandant_id = :id`,
          { id: mandantId },
        );
        nr = `L-${String(Number(cnt[0]!.n) + 1).padStart(4, '0')}`;
      }

      const id = randomUUID();
      try {
        await pool.query(
          `INSERT INTO fibu_lieferanten
             (id, mandant_id, nr, name, uid, adresse, plz, ort, land, iban, bank_name,
              zahlungsbedingung_tage, skonto_prozent, skonto_tage, standard_konto_nr, mwst_code, waehrung, notiz)
           VALUES
             (:id, :mandant_id, :nr, :name, :uid, :adresse, :plz, :ort, :land, :iban, :bank_name,
              :zahlungsbedingung_tage, :skonto_prozent, :skonto_tage, :standard_konto_nr, :mwst_code, :waehrung, :notiz)`,
          {
            id, mandant_id: mandantId, nr, name: b.name.trim(),
            uid: b.uid ?? null, adresse: b.adresse ?? null, plz: b.plz ?? null, ort: b.ort ?? null,
            land: b.land ?? 'CH', iban: b.iban ?? null, bank_name: b.bank_name ?? null,
            zahlungsbedingung_tage: b.zahlungsbedingung_tage ?? 30,
            skonto_prozent: b.skonto_prozent ?? null, skonto_tage: b.skonto_tage ?? null,
            standard_konto_nr: b.standard_konto_nr ?? null, mwst_code: b.mwst_code ?? 'M81',
            waehrung: b.waehrung ?? 'CHF', notiz: b.notiz ?? null,
          },
        );
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${LIEFERANT_FIELDS} FROM fibu_lieferanten WHERE id = :id`, { id },
      );
      return reply.code(201).send(rows[0]);
    },
  );

  // ── Lieferant: Bearbeiten ──
  app.patch<{ Params: { id: string }; Body: LieferantInput }>('/lieferanten/:id', async (req, reply) => {
    const id = req.params.id;
    const b = req.body ?? {};
    const allowed: (keyof LieferantInput)[] = [
      'nr', 'name', 'uid', 'adresse', 'plz', 'ort', 'land', 'iban', 'bank_name',
      'zahlungsbedingung_tage', 'skonto_prozent', 'skonto_tage', 'standard_konto_nr', 'mwst_code', 'waehrung', 'notiz', 'aktiv',
    ];
    const sets: string[] = [];
    const params: Record<string, string | number | boolean | null | undefined> = { id };
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(b, key)) { sets.push(`${key} = :${key}`); params[key] = b[key] ?? null; }
    }
    if (sets.length === 0) return reply.code(400).send({ error: 'Keine Felder zum Aktualisieren' });

    const [res] = await pool.query<ResultSetHeader>(
      `UPDATE fibu_lieferanten SET ${sets.join(', ')} WHERE id = :id`, params,
    );
    if (res.affectedRows === 0) return reply.code(404).send({ error: 'Lieferant nicht gefunden' });
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ${LIEFERANT_FIELDS} FROM fibu_lieferanten WHERE id = :id`, { id },
    );
    return rows[0];
  });
}

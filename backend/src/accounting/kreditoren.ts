// DB-Schicht für die Kreditoren-Verbuchung: lädt Beleg/Positionen/Stammdaten,
// ruft die reine Engine (`buildKreditorenBuchungen`) auf, vergibt atomar
// Buchungsnummern (BU-JJJJ-00001) und schreibt die Hauptbuch-Zeilen in einer
// Transaktion. Portiert aus `fibu_kreditoren_verbuchen` (mailflow).

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { buildKreditorenBuchungen } from './posting.js';
import { formatRappen, parseRappen } from './money.js';
import {
  AccountingError,
  type Buchung,
  type KreditorenBeleg,
  type KreditorenPosition,
  type MwstCodeInfo,
  type MwstMethode,
} from './types.js';

export interface PostResult {
  belegId: string;
  buchungsNrs: string[];
  buchungen: Buchung[];
  /** true, wenn der Beleg bereits verbucht war (keine Änderung). */
  bereitsVerbucht: boolean;
}

export async function postKreditorenBeleg(belegId: string): Promise<PostResult> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [belegRows] = await conn.query<RowDataPacket[]>(
      `SELECT b.id, b.mandant_id, b.beleg_nr, b.belegtyp, b.waehrung,
              b.betrag_netto, b.betrag_mwst, b.betrag_brutto,
              b.verbucht, b.gebucht_von,
              DATE_FORMAT(COALESCE(b.buchungsdatum, b.belegdatum), '%Y-%m-%d') AS buchungsdatum,
              l.name AS lieferant_name
         FROM fibu_kreditoren_belege b
         JOIN fibu_lieferanten l ON l.id = b.lieferant_id
        WHERE b.id = :belegId
        FOR UPDATE`,
      { belegId },
    );
    if (belegRows.length === 0) {
      throw new AccountingError('Kreditoren-Beleg nicht gefunden');
    }
    const row = belegRows[0]!;
    if (row.verbucht) {
      await conn.commit();
      return { belegId, buchungsNrs: [], buchungen: [], bereitsVerbucht: true };
    }

    const mandantId: string = row.mandant_id;
    const buchungsdatum: string = row.buchungsdatum;

    const [mandantRows] = await conn.query<RowDataPacket[]>(
      `SELECT mwst_methode, fw_buchungskurs FROM fibu_mandanten WHERE id = :mandantId AND aktiv`,
      { mandantId },
    );
    if (mandantRows.length === 0) {
      throw new AccountingError('Aktiver FiBu-Mandant nicht gefunden');
    }
    const methode = (mandantRows[0]!.mwst_methode ?? 'effektiv') as MwstMethode;
    const kurstyp: string = mandantRows[0]!.fw_buchungskurs ?? 'monat';

    const [kontoRows] = await conn.query<RowDataPacket[]>(
      `SELECT 1 FROM fibu_konten
        WHERE mandant_id = :mandantId AND konto_nr = '2000'
          AND konto_typ = 'passiv' AND aktiv`,
      { mandantId },
    );
    if (kontoRows.length === 0) {
      throw new AccountingError('Aktives Kreditorenkonto 2000 fehlt');
    }

    // Positionen laden.
    const [posRows] = await conn.query<RowDataPacket[]>(
      `SELECT position, konto_nr, bezeichnung, mwst_code,
              betrag_netto, betrag_mwst, betrag_brutto
         FROM fibu_kreditoren_positionen
        WHERE beleg_id = :belegId AND mandant_id = :mandantId
        ORDER BY position`,
      { belegId, mandantId },
    );
    const positionen: KreditorenPosition[] = posRows.map((p) => ({
      position: Number(p.position),
      kontoNr: p.konto_nr,
      bezeichnung: p.bezeichnung ?? null,
      mwstCode: p.mwst_code,
      betragNetto: parseRappen(p.betrag_netto),
      betragMwst: parseRappen(p.betrag_mwst),
      betragBrutto: parseRappen(p.betrag_brutto),
    }));

    // MwSt-Codes und Kontotypen des Mandanten als Nachschlage-Maps.
    const [mwstRows] = await conn.query<RowDataPacket[]>(
      `SELECT code, typ, konto_vorsteuer FROM fibu_mwst_codes WHERE mandant_id = :mandantId`,
      { mandantId },
    );
    const mwstByCode = new Map<string, MwstCodeInfo>(
      mwstRows.map((m) => [m.code, { code: m.code, typ: m.typ, kontoVorsteuer: m.konto_vorsteuer ?? null }]),
    );

    const [kontenRows] = await conn.query<RowDataPacket[]>(
      `SELECT konto_nr, konto_typ FROM fibu_konten WHERE mandant_id = :mandantId`,
      { mandantId },
    );
    const kontoTypByNr = new Map<string, string>(kontenRows.map((k) => [k.konto_nr, k.konto_typ]));

    const beleg: KreditorenBeleg = {
      belegNr: row.beleg_nr,
      belegtyp: row.belegtyp,
      waehrung: row.waehrung ?? 'CHF',
      lieferantName: row.lieferant_name,
      betragNetto: parseRappen(row.betrag_netto),
      betragMwst: parseRappen(row.betrag_mwst),
      betragBrutto: parseRappen(row.betrag_brutto),
    };

    // Buchungskurs (CHF = 1, sonst jüngster Kurs ≤ Buchungsdatum).
    const kurs = await resolveKurs(conn, beleg.waehrung, kurstyp, buchungsdatum);

    // Reine Buchungslogik.
    const buchungen = buildKreditorenBuchungen(beleg, positionen, mwstByCode, {
      methode,
      kurs,
      kontoTypByNr,
    });

    // Atomare Buchungsnummern (BU-JJJJ-NNNNN), fortlaufend innerhalb der Transaktion.
    const jahr = new Date().getFullYear();
    const [lastRows] = await conn.query<RowDataPacket[]>(
      `SELECT buchungs_nr FROM fibu_buchungen
        WHERE mandant_id = :mandantId AND buchungs_nr LIKE :prefix
        ORDER BY buchungs_nr DESC LIMIT 1
        FOR UPDATE`,
      { mandantId, prefix: `BU-${jahr}-%` },
    );
    let seq = lastRows.length > 0 ? Number(String(lastRows[0]!.buchungs_nr).split('-')[2]) : 0;

    const buchungsNrs: string[] = [];
    for (const b of buchungen) {
      seq += 1;
      const buchungsNr = `BU-${jahr}-${String(seq).padStart(5, '0')}`;
      buchungsNrs.push(buchungsNr);
      await conn.query(
        `INSERT INTO fibu_buchungen
           (mandant_id, buchungs_nr, buchungsdatum, beleg_ref,
            konto_soll, konto_haben, betrag, mwst_code, mwst_betrag,
            text, quelle, quelle_id, created_by, fw_waehrung, fw_betrag)
         VALUES
           (:mandantId, :buchungsNr, :buchungsdatum, :belegRef,
            :kontoSoll, :kontoHaben, :betrag, :mwstCode, :mwstBetrag,
            :text, 'kreditoren', :quelleId, :createdBy, :fwWaehrung, :fwBetrag)`,
        {
          mandantId,
          buchungsNr,
          buchungsdatum,
          belegRef: beleg.belegNr,
          kontoSoll: b.kontoSoll,
          kontoHaben: b.kontoHaben,
          betrag: formatRappen(b.betrag),
          mwstCode: b.mwstCode,
          mwstBetrag: b.mwstBetrag === null ? null : formatRappen(b.mwstBetrag),
          text: b.text,
          quelleId: belegId,
          createdBy: row.gebucht_von ?? null,
          fwWaehrung: b.fwWaehrung,
          fwBetrag: b.fwBetrag === null ? null : formatRappen(b.fwBetrag),
        },
      );
    }

    await conn.query(
      `UPDATE fibu_kreditoren_belege
          SET kurs = :kurs, verbucht = TRUE, gebucht_am = NOW(), updated_at = NOW()
        WHERE id = :belegId`,
      { kurs, belegId },
    );

    await conn.commit();
    return { belegId, buchungsNrs, buchungen, bereitsVerbucht: false };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function resolveKurs(
  conn: PoolConnection,
  waehrung: string,
  kurstyp: string,
  buchungsdatum: string,
): Promise<number> {
  if ((waehrung ?? 'CHF') === 'CHF') return 1;
  // Zuerst den passenden Kurstyp, sonst irgendeinen jüngsten Kurs ≤ Buchungsdatum.
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT kurs FROM fibu_wechselkurse
      WHERE waehrung = :waehrung AND typ = :kurstyp AND datum <= :datum
      ORDER BY datum DESC LIMIT 1`,
    { waehrung, kurstyp, datum: buchungsdatum },
  );
  if (rows.length > 0) return Number(rows[0]!.kurs);
  const [fallback] = await conn.query<RowDataPacket[]>(
    `SELECT kurs FROM fibu_wechselkurse
      WHERE waehrung = :waehrung AND datum <= :datum
      ORDER BY datum DESC LIMIT 1`,
    { waehrung, datum: buchungsdatum },
  );
  if (fallback.length > 0) return Number(fallback[0]!.kurs);
  throw new AccountingError(`Kein Wechselkurs für ${waehrung} per ${buchungsdatum} vorhanden`);
}

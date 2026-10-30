// Verifikation der Kreditoren-Verbuchung gegen die geseedete Test-DB.
// Legt (idempotent) einen Lieferanten + Beleg mit 2 Positionen an, verbucht ihn
// und prüft die resultierenden Hauptbuch-Salden sowie die Idempotenz.
//
// Ausführen: npm run accounting:verify -w @smarterp/backend
// (Voraussetzung: migrate + seed wurden ausgeführt, MariaDB läuft.)

import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { postKreditorenBeleg } from './kreditoren.js';
import { formatRappen, parseRappen, type Rappen } from './money.js';

const MANDANT = '00000000-0000-0000-0000-000000000001';
const LIEFERANT = '00000000-0000-0000-0000-0000000000a1';
const BELEG = '00000000-0000-0000-0000-0000000000b1';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FEHLGESCHLAGEN: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function seedBeleg(): Promise<void> {
  // Vorherige Demo-Daten entfernen (Buchungen haben keine FK auf den Beleg).
  await pool.query('DELETE FROM fibu_buchungen WHERE quelle_id = ?', [BELEG]);
  await pool.query('DELETE FROM fibu_kreditoren_belege WHERE id = ?', [BELEG]); // Positionen cascaden

  await pool.query(
    `INSERT IGNORE INTO fibu_lieferanten (id, mandant_id, nr, name, mwst_code)
     VALUES (?, ?, 'L-DEMO', 'Demo Lieferant AG', 'M81')`,
    [LIEFERANT, MANDANT],
  );

  await pool.query(
    `INSERT INTO fibu_kreditoren_belege
       (id, mandant_id, beleg_nr, lieferant_id, belegdatum, faelligkeit, waehrung,
        betrag_netto, betrag_mwst, betrag_brutto)
     VALUES (?, ?, 'KR-DEMO-0001', ?, '2026-10-30', '2026-11-29', 'CHF',
             '150.00', '9.40', '159.40')`,
    [BELEG, MANDANT, LIEFERANT],
  );

  await pool.query(
    `INSERT INTO fibu_kreditoren_positionen
       (mandant_id, beleg_id, position, konto_nr, bezeichnung, mwst_code, mwst_satz,
        betrag_netto, betrag_mwst, betrag_brutto)
     VALUES
       (?, ?, 1, '6500', 'Cloud-Hosting', 'M81', 8.1, '100.00', '8.10', '108.10'),
       (?, ?, 2, '6600', 'Büromaterial',  'M26', 2.6, '50.00',  '1.30', '51.30')`,
    [MANDANT, BELEG, MANDANT, BELEG],
  );
}

async function accountBalancesFromDb(): Promise<Map<string, Rappen>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT konto_soll, konto_haben, betrag FROM fibu_buchungen WHERE quelle_id = ?`,
    [BELEG],
  );
  const bal = new Map<string, Rappen>();
  for (const r of rows) {
    const b = parseRappen(r.betrag);
    bal.set(r.konto_soll, (bal.get(r.konto_soll) ?? 0) + b);
    bal.set(r.konto_haben, (bal.get(r.konto_haben) ?? 0) - b);
  }
  return bal;
}

async function main(): Promise<void> {
  console.log('→ Demo-Beleg anlegen …');
  await seedBeleg();

  console.log('→ Verbuchen …');
  const res = await postKreditorenBeleg(BELEG);
  console.log(`  Buchungsnummern: ${res.buchungsNrs.join(', ')}`);
  for (const b of res.buchungen) {
    console.log(`    ${b.kontoSoll} an ${b.kontoHaben}  ${formatRappen(b.betrag)}`);
  }

  console.log('→ Hauptbuch-Salden prüfen …');
  const bal = await accountBalancesFromDb();
  const get = (k: string): Rappen => bal.get(k) ?? 0;
  assert(res.buchungen.length === 4, '4 Hauptbuch-Zeilen erzeugt');
  assert(get('6500') === 10000, 'Konto 6500 Soll +100.00');
  assert(get('6600') === 5000, 'Konto 6600 Soll +50.00');
  assert(get('1170') === 940, 'Konto 1170 (Vorsteuer) Soll +9.40');
  assert(get('2000') === -15940, 'Konto 2000 (Kreditoren) Haben −159.40');
  let total = 0;
  for (const v of bal.values()) total += v;
  assert(total === 0, 'Double-Entry ausgeglichen (Summe aller Salden = 0)');

  console.log('→ Idempotenz prüfen (erneut verbuchen) …');
  const res2 = await postKreditorenBeleg(BELEG);
  assert(res2.bereitsVerbucht, 'Zweiter Verbuchungsversuch ist No-op');
  const [cnt] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM fibu_buchungen WHERE quelle_id = ?`,
    [BELEG],
  );
  assert(Number(cnt[0]!.n) === 4, 'Weiterhin genau 4 Hauptbuch-Zeilen (keine Duplikate)');

  console.log('✓ Kreditoren-Verbuchung verifiziert.');
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });

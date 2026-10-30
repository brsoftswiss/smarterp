// Paritäts-Harness (§7): denselben Kreditoren-Fall in ERPNext (Purchase Invoice)
// und in smarterp (eigene Engine) buchen, die resultierenden Hauptbuch-Salden
// normalisieren und diffen.
//
// Ausführen: npm run accounting:parity -w @smarterp/backend
// Voraussetzungen:
//   - MariaDB läuft, `npm run migrate` + `npm run seed` gelaufen.
//   - ERPNext-Orakel läuft (tooling/erpnext-parity, http://localhost:8081).
// ENV (optional): ERPNEXT_URL, ERPNEXT_COMPANY, ERPNEXT_API_KEY/SECRET, ERPNEXT_USER/PASSWORD.

import { pool } from '../../db/pool.js';
import { postKreditorenBeleg } from '../kreditoren.js';
import { accountBalances } from '../posting.js';
import { formatRappen, type Rappen } from '../money.js';
import { ErpClient, erpConfigFromEnv } from './erpnext.js';
import { KREDITOREN_CASE, bookErpnextCase, companyAbbr, provisionErpnext } from './case.js';

const MANDANT = '00000000-0000-0000-0000-000000000001';
const LIEFERANT = '00000000-0000-0000-0000-0000000000a1';
const BELEG = '00000000-0000-0000-0000-0000000000b1';

interface SeedPos {
  position: number;
  kontoNr: string;
  bezeichnung: string;
  mwstCode: string;
  mwstSatz: number;
  nettoChf: number;
  mwstChf: number;
  bruttoChf: number;
}

function casePositions(): SeedPos[] {
  return KREDITOREN_CASE.positionen.map((p, i) => {
    const mwstChf = Math.round(p.nettoChf * p.vatRate) / 100;
    return {
      position: i + 1,
      kontoNr: p.chKonto,
      bezeichnung: p.bezeichnung,
      mwstCode: p.vatCode,
      mwstSatz: p.vatRate,
      nettoChf: p.nettoChf,
      mwstChf,
      bruttoChf: p.nettoChf + mwstChf,
    };
  });
}

/** Demo-Beleg (identisch zum ERPNext-Fall) in smarterp anlegen und verbuchen. */
async function bookSmarterpCase(): Promise<{ buchungsNrs: string[]; balances: Map<string, Rappen> }> {
  const pos = casePositions();
  const headNetto = pos.reduce((s, p) => s + p.nettoChf, 0);
  const headMwst = pos.reduce((s, p) => s + p.mwstChf, 0);
  const headBrutto = headNetto + headMwst;
  const f2 = (n: number): string => n.toFixed(2);

  // Zurücksetzen (idempotent).
  await pool.query('DELETE FROM fibu_buchungen WHERE quelle_id = ?', [BELEG]);
  await pool.query('DELETE FROM fibu_kreditoren_belege WHERE id = ?', [BELEG]);

  await pool.query(
    `INSERT IGNORE INTO fibu_lieferanten (id, mandant_id, nr, name, mwst_code)
     VALUES (?, ?, 'L-DEMO', ?, 'M81')`,
    [LIEFERANT, MANDANT, KREDITOREN_CASE.lieferantName],
  );
  await pool.query(
    `INSERT INTO fibu_kreditoren_belege
       (id, mandant_id, beleg_nr, lieferant_id, belegdatum, faelligkeit, waehrung,
        betrag_netto, betrag_mwst, betrag_brutto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [BELEG, MANDANT, KREDITOREN_CASE.billNo, LIEFERANT, KREDITOREN_CASE.belegdatum,
     KREDITOREN_CASE.faelligkeit, KREDITOREN_CASE.waehrung, f2(headNetto), f2(headMwst), f2(headBrutto)],
  );
  for (const p of pos) {
    await pool.query(
      `INSERT INTO fibu_kreditoren_positionen
         (mandant_id, beleg_id, position, konto_nr, bezeichnung, mwst_code, mwst_satz,
          betrag_netto, betrag_mwst, betrag_brutto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [MANDANT, BELEG, p.position, p.kontoNr, p.bezeichnung, p.mwstCode, p.mwstSatz,
       f2(p.nettoChf), f2(p.mwstChf), f2(p.bruttoChf)],
    );
  }

  const res = await postKreditorenBeleg(BELEG);
  return { buchungsNrs: res.buchungsNrs, balances: accountBalances(res.buchungen) };
}

function printBalances(title: string, bal: Map<string, Rappen>): void {
  console.log(`  ${title}`);
  for (const k of [...bal.keys()].sort()) console.log(`    ${k.padEnd(6)} ${formatRappen(bal.get(k)!).padStart(10)}`);
}

function diff(erp: Map<string, Rappen>, smart: Map<string, Rappen>): string[] {
  const konten = [...new Set([...erp.keys(), ...smart.keys()])].sort();
  const problems: string[] = [];
  console.log('\n→ Vergleich (Soll−Haben je Konto, in CHF):');
  console.log(`    ${'Konto'.padEnd(6)} ${'ERPNext'.padStart(10)} ${'smarterp'.padStart(10)}   Status`);
  for (const k of konten) {
    const e = erp.get(k) ?? 0;
    const s = smart.get(k) ?? 0;
    const ok = e === s;
    if (!ok) problems.push(`Konto ${k}: ERPNext ${formatRappen(e)} ≠ smarterp ${formatRappen(s)}`);
    console.log(`    ${k.padEnd(6)} ${formatRappen(e).padStart(10)} ${formatRappen(s).padStart(10)}   ${ok ? '✓' : '✗ DIFF'}`);
  }
  return problems;
}

async function main(): Promise<void> {
  const cfg = erpConfigFromEnv();
  const company = process.env.ERPNEXT_COMPANY ?? 'Comp1';
  const erp = new ErpClient(cfg);

  console.log(`→ ERPNext verbinden (${cfg.baseUrl}, Company ${company}) …`);
  await erp.connect();
  const abbr = await companyAbbr(erp, company);

  console.log('→ ERPNext bereitstellen (Konten/Templates/Items/Lieferant) …');
  const expenseByCh = await provisionErpnext(erp, company, abbr);

  console.log('→ ERPNext: Purchase Invoice buchen …');
  const erpRes = await bookErpnextCase(erp, company, abbr, expenseByCh);
  console.log(`  Voucher ${erpRes.voucherNo}`);
  printBalances('ERPNext-GL (CH-normalisiert):', erpRes.balances);

  console.log('→ smarterp: Beleg verbuchen …');
  const smartRes = await bookSmarterpCase();
  console.log(`  Buchungen ${smartRes.buchungsNrs.join(', ')}`);
  printBalances('smarterp-GL:', smartRes.balances);

  const problems = diff(erpRes.balances, smartRes.balances);
  if (problems.length === 0) {
    console.log('\n✓ Parität: ERPNext und smarterp erzeugen identische Hauptbuch-Salden.');
  } else {
    console.log('\n✗ Abweichungen:');
    for (const p of problems) console.log(`  - ${p}`);
    throw new Error('Paritäts-Abweichung festgestellt');
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('\n' + (err instanceof Error ? err.message : String(err)));
    await pool.end();
    process.exit(1);
  });

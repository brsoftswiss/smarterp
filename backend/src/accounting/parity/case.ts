// Kanonischer Paritäts-Geschäftsfall (Kreditoren-Einkaufsrechnung) + ERPNext-Seite.
//
// Derselbe Fall wird in beiden Systemen gebucht:
//   - smarterp: über die eigene Engine (siehe run.ts)
//   - ERPNext:  als Purchase Invoice (hier)
// Danach werden die GL-Salden über ein Konten-Mapping normalisiert und verglichen.
//
// Aufwandskonten werden in ERPNext über die account_number aufgelöst (unabhängig
// vom Anzeigenamen), damit der Harness instanz-/namensunabhängig bleibt.

import type { Rappen } from '../money.js';
import { ErpClient, ErpError } from './erpnext.js';

export interface CasePosition {
  /** CH-KMU-Kontonummer (smarterp-Seite, zugleich ERPNext-account_number). */
  chKonto: string;
  bezeichnung: string;
  /** ERPNext-Service-Item. */
  itemCode: string;
  /** Nettobetrag in CHF. */
  nettoChf: number;
  /** smarterp-MwSt-Code. */
  vatCode: string;
  /** Vorsteuersatz in %. */
  vatRate: number;
  /** ERPNext-Steuerkonto-Basisname (ohne Firmen-Kürzel), z. B. "VAT 8.1%". */
  vatLabel: string;
}

export interface KreditorenCase {
  billNo: string;
  belegdatum: string;
  faelligkeit: string;
  waehrung: string;
  lieferantName: string;
  /** CH-Sammelkonto Kreditoren. */
  creditorsCh: string;
  /** CH-Vorsteuerkonto (alle ERPNext-VAT-Konten mappen hierauf). */
  vorsteuerCh: string;
  positionen: CasePosition[];
}

/** Entspricht 1:1 dem Fall aus `accounting/verify.ts`. */
export const KREDITOREN_CASE: KreditorenCase = {
  billNo: 'KR-DEMO-0001',
  belegdatum: '2026-10-30',
  faelligkeit: '2026-11-29',
  waehrung: 'CHF',
  lieferantName: 'Demo Lieferant AG',
  creditorsCh: '2000',
  vorsteuerCh: '1170',
  positionen: [
    { chKonto: '6500', bezeichnung: 'Cloud-Hosting', itemCode: 'SMARTERP-6500', nettoChf: 100, vatCode: 'M81', vatRate: 8.1, vatLabel: 'VAT 8.1%' },
    { chKonto: '6600', bezeichnung: 'Büromaterial', itemCode: 'SMARTERP-6600', nettoChf: 50, vatCode: 'M26', vatRate: 2.6, vatLabel: 'VAT 2.6%' },
  ],
};

/** Aufgelöste ERPNext-Aufwandskonten: CH-Nummer → ERPNext-Kontoname. */
export type ExpenseAccounts = Map<string, string>;

const toRappen = (chf: number): Rappen => Math.round(chf * 100);

function vatLabels(c: KreditorenCase): string[] {
  return [...new Set(c.positionen.map((p) => p.vatLabel))];
}

/** ERPNext-Kontoname → CH-KMU-Kontonummer. */
export function buildAccountMap(c: KreditorenCase, abbr: string, expense: ExpenseAccounts): Map<string, string> {
  const m = new Map<string, string>();
  for (const [ch, name] of expense) m.set(name, ch);
  for (const label of vatLabels(c)) m.set(`${label} - ${abbr}`, c.vorsteuerCh);
  m.set(`Creditors - ${abbr}`, c.creditorsCh);
  return m;
}

/** ERPNext-GL-Einträge in CH-Salden (Soll−Haben in Rappen) normalisieren. */
export function normalizeErpGl(
  gl: { account: string; debit: number; credit: number }[],
  accountMap: Map<string, string>,
): Map<string, Rappen> {
  const bal = new Map<string, Rappen>();
  for (const e of gl) {
    const ch = accountMap.get(e.account);
    if (!ch) throw new ErpError(`Nicht gemapptes ERPNext-Konto: ${e.account}`);
    const r = toRappen(e.debit - e.credit);
    bal.set(ch, (bal.get(ch) ?? 0) + r);
  }
  return bal;
}

/** Firmenkürzel (abbr) der Company lesen. */
export async function companyAbbr(erp: ErpClient, company: string): Promise<string> {
  const doc = await erp.getDoc<{ abbr?: string }>('Company', company);
  if (!doc.abbr) throw new ErpError(`Company ${company} hat kein abbr`);
  return doc.abbr;
}

/** Aufwandskonto über account_number auflösen (sonst anlegen). */
async function resolveExpenseAccount(
  erp: ErpClient,
  company: string,
  parentExpense: string,
  p: CasePosition,
): Promise<string> {
  const found = await erp.list<{ name: string }>(
    'Account',
    [['company', '=', company], ['account_number', '=', p.chKonto]],
    ['name'],
    1,
  );
  if (found.length > 0) return found[0]!.name;
  const created = await erp.createDoc<{ name: string }>('Account', {
    account_name: p.bezeichnung,
    account_number: p.chKonto,
    company,
    parent_account: parentExpense,
    root_type: 'Expense',
    report_type: 'Profit and Loss',
    is_group: 0,
  });
  return created.name;
}

/** Idempotentes Anlegen von Konten/Templates/Items/Lieferant; liefert die Aufwandskonten-Namen. */
export async function provisionErpnext(erp: ErpClient, company: string, abbr: string): Promise<ExpenseAccounts> {
  const c = KREDITOREN_CASE;
  const labels = vatLabels(c);

  // VAT-Konten müssen (aus dem CH-Kontenrahmen) vorhanden sein.
  for (const label of labels) {
    const name = `${label} - ${abbr}`;
    if (!(await erp.exists('Account', name))) {
      throw new ErpError(`Steuerkonto "${name}" fehlt in ERPNext (CH-Kontenrahmen erwartet).`);
    }
  }

  // Aufwands-Elterngruppe (Expense).
  const groups = await erp.list<{ name: string }>(
    'Account',
    [['company', '=', company], ['root_type', '=', 'Expense'], ['is_group', '=', 1]],
    ['name'],
    20,
  );
  if (groups.length === 0) throw new ErpError('Keine Aufwands-Kontengruppe gefunden.');
  const parentExpense = groups.find((g) => /Direct Expenses/.test(g.name))?.name ?? groups[0]!.name;

  // Aufwandskonten je Position auflösen/anlegen.
  const expense: ExpenseAccounts = new Map();
  for (const p of c.positionen) {
    expense.set(p.chKonto, await resolveExpenseAccount(erp, company, parentExpense, p));
  }

  // Item-Tax-Templates: alle VAT-Köpfe, nur der eigene Satz > 0.
  for (const p of c.positionen) {
    const expectedName = `CH-${p.vatCode} - ${abbr}`;
    const taxes = labels.map((label) => ({
      tax_type: `${label} - ${abbr}`,
      tax_rate: label === p.vatLabel ? p.vatRate : 0,
    }));
    if (await erp.exists('Item Tax Template', expectedName)) {
      await erp.updateDoc('Item Tax Template', expectedName, { taxes });
    } else {
      await erp.createDoc('Item Tax Template', { title: `CH-${p.vatCode}`, company, taxes });
    }
  }

  // Service-Items.
  for (const p of c.positionen) {
    await erp.ensure('Item', p.itemCode, {
      item_code: p.itemCode,
      item_name: p.bezeichnung,
      item_group: 'Services',
      stock_uom: 'Nos',
      is_stock_item: 0,
      is_purchase_item: 1,
      item_defaults: [{ company, expense_account: expense.get(p.chKonto) }],
      taxes: [{ item_tax_template: `CH-${p.vatCode} - ${abbr}` }],
    });
  }

  // Lieferant.
  await erp.ensure('Supplier', c.lieferantName, {
    supplier_name: c.lieferantName,
    supplier_group: 'Services',
    supplier_type: 'Company',
    default_currency: c.waehrung,
  });

  return expense;
}

/** Bucht den Fall als Purchase Invoice und gibt normalisierte CH-Salden zurück. */
export async function bookErpnextCase(
  erp: ErpClient,
  company: string,
  abbr: string,
  expense: ExpenseAccounts,
): Promise<{ voucherNo: string; balances: Map<string, Rappen> }> {
  const c = KREDITOREN_CASE;
  const labels = vatLabels(c);

  // Frühere submitted PIs mit dieser bill_no stornieren (Idempotenz).
  const old = await erp.list<{ name: string }>(
    'Purchase Invoice',
    [['bill_no', '=', c.billNo], ['docstatus', '=', 1]],
    ['name'],
  );
  for (const o of old) await erp.cancel('Purchase Invoice', o.name);

  const items = c.positionen.map((p) => ({
    item_code: p.itemCode,
    qty: 1,
    rate: p.nettoChf,
    expense_account: expense.get(p.chKonto),
    item_tax_template: `CH-${p.vatCode} - ${abbr}`,
    item_tax_rate: JSON.stringify(
      Object.fromEntries(labels.map((label) => [`${label} - ${abbr}`, label === p.vatLabel ? p.vatRate : 0])),
    ),
  }));

  // Pro VAT-Kopf eine Steuerzeile (Satz wird je Item über item_tax_rate überschrieben).
  const taxes = labels.map((label) => {
    const rate = c.positionen.find((p) => p.vatLabel === label)!.vatRate;
    return { charge_type: 'On Net Total', account_head: `${label} - ${abbr}`, description: label, rate };
  });

  const pi = await erp.createDoc<{ name: string }>('Purchase Invoice', {
    company,
    supplier: c.lieferantName,
    posting_date: c.belegdatum,
    bill_no: c.billNo,
    bill_date: c.belegdatum,
    due_date: c.faelligkeit,
    currency: c.waehrung,
    credit_to: `Creditors - ${abbr}`,
    items,
    taxes,
  });
  await erp.submit('Purchase Invoice', pi.name);

  const gl = await erp.glEntries(pi.name);
  const balances = normalizeErpGl(gl, buildAccountMap(c, abbr, expense));
  return { voucherNo: pi.name, balances };
}

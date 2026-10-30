// Reine Buchungslogik (ohne DB) — portiert aus mailflows PL/pgSQL-Funktion
// `fibu_kreditoren_verbuchen` (supabase/migrations/20260726192000_...). Getestet
// isoliert, damit sie später gegen eine echte ERPNext-Instanz abgeglichen werden kann.

import {
  AccountingError,
  type Buchung,
  type GlEntry,
  type KreditorenBeleg,
  type KreditorenPosition,
  type MwstCodeInfo,
  type MwstMethode,
} from './types.js';
import { applyKurs, type Rappen } from './money.js';

/** Sammel-Kreditorenkonto (CH KMU). */
export const KREDITOREN_KONTO = '2000';

/** Toleranz für den Abgleich Kopfsummen ↔ Positionssummen: 0.02 CHF (wie SQL). */
const TOLERANZ_RAPPEN: Rappen = 2;

export interface BuildOptions {
  methode: MwstMethode;
  /** Buchungskurs (1 für CHF). */
  kurs: number;
  /** konto_nr → konto_typ, zur Validierung der Aufwands-/Aktivkontierung. */
  kontoTypByNr: Map<string, string>;
}

/**
 * Baut aus einem Kreditoren-Beleg + Positionen die Hauptbuch-Zeilen.
 * Pro Position:
 *   - Aufwand (Soll) an Kreditoren 2000 (Haben), Betrag = Basis × Kurs
 *     (Basis = Netto bei «effektiv», Brutto bei «saldosteuersatz»).
 *   - Falls MwSt > 0 und «effektiv»: Vorsteuerkonto (Soll) an 2000 (Haben).
 * Bei Gutschriften sind Soll/Haben getauscht und die MwSt negativ.
 */
export function buildKreditorenBuchungen(
  beleg: KreditorenBeleg,
  positionen: KreditorenPosition[],
  mwstByCode: Map<string, MwstCodeInfo>,
  opts: BuildOptions,
): Buchung[] {
  if (positionen.length === 0) {
    throw new AccountingError('Kreditoren-Beleg hat keine Positionen');
  }
  if (opts.methode !== 'effektiv' && opts.methode !== 'saldosteuersatz') {
    throw new AccountingError(`Nicht unterstützte MWST-Methode: ${opts.methode}`);
  }

  const istSaldo = opts.methode === 'saldosteuersatz';
  const istGutschrift = beleg.belegtyp === 'gutschrift';
  const vz = istGutschrift ? -1 : 1;
  const fw = beleg.waehrung === 'CHF' ? null : beleg.waehrung;

  // Kopfsummen gegen Positionssummen prüfen (Toleranz 0.02).
  let sumNetto = 0;
  let sumMwst = 0;
  let sumBrutto = 0;
  for (const p of positionen) {
    sumNetto += p.betragNetto;
    sumMwst += p.betragMwst;
    sumBrutto += p.betragBrutto;
  }
  if (
    Math.abs(beleg.betragNetto - vz * sumNetto) > TOLERANZ_RAPPEN ||
    Math.abs(beleg.betragMwst - vz * sumMwst) > TOLERANZ_RAPPEN ||
    Math.abs(beleg.betragBrutto - vz * sumBrutto) > TOLERANZ_RAPPEN
  ) {
    throw new AccountingError('Kreditoren-Kopfsummen stimmen nicht mit den Positionen überein');
  }

  const buchungen: Buchung[] = [];

  for (const pos of positionen) {
    const mc = mwstByCode.get(pos.mwstCode);
    if (!mc) {
      throw new AccountingError(`Unbekannter MwSt-Code: ${pos.mwstCode}`);
    }
    if (mc.typ !== 'vorsteuer' && mc.typ !== 'steuerbefreit') {
      throw new AccountingError(
        `Ungültige Kreditoren-Kontierung: MwSt-Code ${pos.mwstCode} ist ${mc.typ}`,
      );
    }
    const kontoTyp = opts.kontoTypByNr.get(pos.kontoNr);
    if (kontoTyp !== 'aufwand' && kontoTyp !== 'aktiv') {
      throw new AccountingError(
        `Ungültige Kreditoren-Kontierung: Konto ${pos.kontoNr} ist weder Aufwand noch Aktiv`,
      );
    }

    const fwBasis = istSaldo ? pos.betragBrutto : pos.betragNetto;
    const fwMwst = pos.betragMwst;
    const chfBasis = applyKurs(fwBasis, opts.kurs);
    const chfMwst = applyKurs(fwMwst, opts.kurs);

    buchungen.push({
      kontoSoll: istGutschrift ? KREDITOREN_KONTO : pos.kontoNr,
      kontoHaben: istGutschrift ? pos.kontoNr : KREDITOREN_KONTO,
      betrag: chfBasis,
      mwstCode: istSaldo ? null : pos.mwstCode,
      mwstBetrag: istSaldo ? null : istGutschrift ? -chfMwst : chfMwst,
      text:
        (pos.bezeichnung ?? `${beleg.lieferantName} / ${beleg.belegNr}`) +
        (istGutschrift ? ' (Gutschrift)' : ''),
      fwWaehrung: fw,
      fwBetrag: fw === null ? null : fwBasis,
    });

    if (!istSaldo && chfMwst > 0) {
      if (!mc.kontoVorsteuer) {
        throw new AccountingError(`Vorsteuerkonto fehlt für Code ${pos.mwstCode}`);
      }
      buchungen.push({
        kontoSoll: istGutschrift ? KREDITOREN_KONTO : mc.kontoVorsteuer,
        kontoHaben: istGutschrift ? mc.kontoVorsteuer : KREDITOREN_KONTO,
        betrag: chfMwst,
        mwstCode: null,
        mwstBetrag: null,
        text: `Vorsteuer ${pos.mwstCode} / ${beleg.belegNr}`,
        fwWaehrung: fw,
        fwBetrag: fw === null ? null : fwMwst,
      });
    }
  }

  assertBalanced(buchungen);
  return buchungen;
}

/** Hauptbuch-Zeilen in normalisierte GL-Einträge (debit/credit je Konto) auffächern. */
export function toGlEntries(buchungen: Buchung[]): GlEntry[] {
  const out: GlEntry[] = [];
  for (const b of buchungen) {
    out.push({ konto: b.kontoSoll, soll: b.betrag, haben: 0 });
    out.push({ konto: b.kontoHaben, soll: 0, haben: b.betrag });
  }
  return out;
}

/** Saldo je Konto (Soll − Haben) in Rappen. */
export function accountBalances(buchungen: Buchung[]): Map<string, Rappen> {
  const m = new Map<string, Rappen>();
  for (const e of toGlEntries(buchungen)) {
    m.set(e.konto, (m.get(e.konto) ?? 0) + e.soll - e.haben);
  }
  return m;
}

/** Double-Entry-Invariante: Summe aller Soll = Summe aller Haben. */
export function assertBalanced(buchungen: Buchung[]): void {
  let soll = 0;
  let haben = 0;
  for (const e of toGlEntries(buchungen)) {
    soll += e.soll;
    haben += e.haben;
  }
  if (soll !== haben) {
    throw new AccountingError(`Buchung nicht ausgeglichen: Soll ${soll} ≠ Haben ${haben} (Rappen)`);
  }
}

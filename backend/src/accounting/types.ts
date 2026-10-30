import type { Rappen } from './money.js';

export type MwstTyp = 'vorsteuer' | 'umsatzsteuer' | 'steuerbefreit' | 'bezugsteuer';
export type MwstMethode = 'effektiv' | 'saldosteuersatz';
export type Belegtyp = 'rechnung' | 'gutschrift';

/** Fehler der Buchungs-Engine (fachliche Verletzung, kein Programmierfehler). */
export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountingError';
  }
}

export interface MwstCodeInfo {
  code: string;
  typ: MwstTyp;
  kontoVorsteuer: string | null;
}

export interface KreditorenPosition {
  position: number;
  kontoNr: string;
  bezeichnung: string | null;
  mwstCode: string;
  betragNetto: Rappen;
  betragMwst: Rappen;
  betragBrutto: Rappen;
}

export interface KreditorenBeleg {
  belegNr: string;
  belegtyp: Belegtyp;
  waehrung: string;
  lieferantName: string;
  betragNetto: Rappen;
  betragMwst: Rappen;
  betragBrutto: Rappen;
}

/**
 * Eine Hauptbuch-Zeile im Soll/Haben-Stil von `fibu_buchungen`
 * (ein Soll-Konto, ein Haben-Konto, ein Betrag — paarweise ausgeglichen).
 */
export interface Buchung {
  kontoSoll: string;
  kontoHaben: string;
  betrag: Rappen;
  mwstCode: string | null;
  mwstBetrag: Rappen | null;
  text: string;
  fwWaehrung: string | null;
  fwBetrag: Rappen | null;
}

/** Normalisierte GL-Zeile je Konto (debit/credit) — Vergleichsbasis für ERPNext-Parität. */
export interface GlEntry {
  konto: string;
  soll: Rappen;
  haben: Rappen;
}

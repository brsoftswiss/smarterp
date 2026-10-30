// Datenshapes der smarterp-REST-API (snake_case wie die DB/Backend-Antworten).

export interface Mandant {
  id: string;
  name: string;
  waehrung: string;
  kontenrahmen: string;
  mwst_methode: string;
  geschaeftsjahr: number;
  aktiv: number;
}

export interface Konto {
  id: string;
  konto_nr: string;
  bezeichnung: string;
  konto_typ: string;
  mwst_code: string | null;
  aktiv: number;
  waehrung: string;
}

export interface MwstCode {
  id: string;
  code: string;
  bezeichnung: string;
  satz: string;
  typ: string;
  konto_vorsteuer: string | null;
  aktiv: number;
  sortierung: number;
}

export interface Lieferant {
  id: string;
  mandant_id: string;
  nr: string;
  name: string;
  uid: string | null;
  adresse: string | null;
  plz: string | null;
  ort: string | null;
  land: string;
  iban: string | null;
  bank_name: string | null;
  zahlungsbedingung_tage: number;
  skonto_prozent: string | null;
  skonto_tage: number | null;
  standard_konto_nr: string | null;
  mwst_code: string;
  waehrung: string;
  notiz: string | null;
  aktiv: number;
}

export interface KreditorBeleg {
  id: string;
  beleg_nr: string;
  lieferant_id: string;
  lieferant_name: string;
  belegdatum: string;
  faelligkeit: string;
  waehrung: string;
  betrag_netto: string;
  betrag_mwst: string;
  betrag_brutto: string;
  status: string;
  belegtyp: string;
  verbucht: number;
}

export interface Position {
  position: number;
  konto_nr: string;
  bezeichnung: string | null;
  mwst_code: string;
  mwst_satz: string;
  betrag_netto: string;
  betrag_mwst: string;
  betrag_brutto: string;
}

export interface Buchung {
  buchungs_nr: string;
  buchungsdatum: string;
  konto_soll: string;
  konto_haben: string;
  betrag: string;
  mwst_code: string | null;
  mwst_betrag: string | null;
  text: string;
}

export interface BelegDetail extends KreditorBeleg {
  positionen: Position[];
  buchungen: Buchung[];
}

/** Eingabe beim Erfassen eines Kreditoren-Belegs. */
export interface BelegInput {
  lieferant_id: string;
  belegdatum: string;
  faelligkeit?: string;
  belegtyp?: 'rechnung' | 'gutschrift';
  belegtext?: string;
  positionen: PositionInput[];
  verbuchen?: boolean;
}

export interface PositionInput {
  konto_nr: string;
  bezeichnung?: string;
  mwst_code: string;
  mwst_satz: number;
  betrag_netto: number;
  betrag_mwst: number;
  betrag_brutto: number;
}

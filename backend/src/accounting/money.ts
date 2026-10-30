// Geldbeträge als ganzzahlige Rappen (1 CHF = 100 Rappen).
// Grund: Der DB-Pool liefert DECIMAL als String (decimalNumbers:false), und
// Buchhaltung darf nicht durch JS-Float-Rundung verfälscht werden. Wir parsen
// die DECIMAL-Strings verlustfrei in Ganzzahlen und rechnen nur mit diesen.

export type Rappen = number; // immer ganzzahlig

/** DECIMAL-String/Zahl aus der DB verlustfrei in Rappen umwandeln. */
export function parseRappen(v: string | number | null | undefined): Rappen {
  if (v === null || v === undefined || v === '') return 0;
  const s = (typeof v === 'number' ? v.toString() : v).trim();
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const rappen = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -rappen : rappen;
}

/** Rappen als DECIMAL(…,2)-String für die DB formatieren, z. B. 10810 -> "108.10". */
export function formatRappen(r: Rappen): string {
  const neg = r < 0;
  const a = Math.abs(r);
  const s = `${Math.floor(a / 100)}.${(a % 100).toString().padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/**
 * Betrag (in Rappen) mit einem Fremdwährungskurs multiplizieren und
 * kaufmännisch auf Rappen runden (round half away from zero — wie SQL round()).
 * Für CHF (kurs = 1) bleibt der Betrag exakt.
 */
export function applyKurs(basis: Rappen, kurs: number): Rappen {
  if (kurs === 1) return basis;
  const exact = basis * kurs;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

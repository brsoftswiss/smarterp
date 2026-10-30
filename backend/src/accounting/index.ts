// Buchungs-Engine (M3, Kern). Reine Logik in `posting`, DB-Anbindung in
// `kreditoren`. Weitere Geschäftsfälle (Zahlung, Storno, Debitoren, manuelle
// Buchung) kommen hier dazu.
export * from './types.js';
export * from './money.js';
export * from './posting.js';
export * from './kreditoren.js';

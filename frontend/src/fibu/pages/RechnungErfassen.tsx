// Rechnung erfassen: Kreditoren-Beleg mit Positionen anlegen und verbuchen.
// Brutto-Methode: pro Position wird der Bruttobetrag erfasst, Netto/MwSt werden
// aus dem Vorsteuersatz zurückgerechnet (wie in der mailflow-Vorlage).
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, chf } from '../api/client';
import { useMandant } from '../state/MandantContext';
import type { Konto, Lieferant, MwstCode } from '../api/types';

interface PosRow { konto_nr: string; bezeichnung: string; mwst_code: string; brutto: string; }

const round2 = (n: number): number => Math.round(n * 100) / 100;
const leereZeile = (konto = '', code = 'M81'): PosRow => ({ konto_nr: konto, bezeichnung: '', mwst_code: code, brutto: '' });

function calc(brutto: string, satz: number): { netto: number; mwst: number; brutto: number } {
  const b = Number(brutto) || 0;
  const netto = round2(b / (1 + satz / 100));
  return { brutto: round2(b), netto, mwst: round2(b - netto) };
}

export function RechnungErfassen() {
  const { mandant } = useMandant();
  const navigate = useNavigate();
  const [lieferanten, setLieferanten] = useState<Lieferant[]>([]);
  const [konten, setKonten] = useState<Konto[]>([]);
  const [codes, setCodes] = useState<MwstCode[]>([]);
  const [lieferantId, setLieferantId] = useState('');
  const [belegdatum, setBelegdatum] = useState(new Date().toISOString().slice(0, 10));
  const [belegtext, setBelegtext] = useState('');
  const [zeilen, setZeilen] = useState<PosRow[]>([leereZeile()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mandant) return;
    Promise.all([
      api.lieferanten.list(mandant.id, { aktiv: true }),
      api.konten.list(mandant.id, { aktiv: true, typ: 'aufwand' }),
      api.mwstCodes.list(mandant.id, { aktiv: true, typ: 'vorsteuer' }),
    ]).then(([l, k, c]) => {
      setLieferanten(l);
      setKonten(k);
      setCodes(c);
      if (l[0]) setLieferantId(l[0].id);
    }).catch((e: Error) => setError(e.message));
  }, [mandant]);

  const satzOf = (code: string): number => Number(codes.find((c) => c.code === code)?.satz ?? 0);

  const summen = useMemo(() => {
    let netto = 0, mwst = 0, brutto = 0;
    for (const z of zeilen) {
      const r = calc(z.brutto, satzOf(z.mwst_code));
      netto += r.netto; mwst += r.mwst; brutto += r.brutto;
    }
    return { netto: round2(netto), mwst: round2(mwst), brutto: round2(brutto) };
  }, [zeilen, codes]);

  function setZeile(i: number, patch: Partial<PosRow>): void {
    setZeilen((zs) => zs.map((z, idx) => (idx === i ? { ...z, ...patch } : z)));
  }

  async function speichern(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!mandant) return;
    setSaving(true);
    setError(null);
    try {
      const positionen = zeilen
        .filter((z) => z.konto_nr && Number(z.brutto) > 0)
        .map((z) => {
          const satz = satzOf(z.mwst_code);
          const r = calc(z.brutto, satz);
          return {
            konto_nr: z.konto_nr,
            bezeichnung: z.bezeichnung || undefined,
            mwst_code: z.mwst_code,
            mwst_satz: satz,
            betrag_netto: r.netto,
            betrag_mwst: r.mwst,
            betrag_brutto: r.brutto,
          };
        });
      if (positionen.length === 0) throw new Error('Mindestens eine Position mit Konto und Betrag erfassen.');
      const beleg = await api.kreditoren.create(mandant.id, {
        lieferant_id: lieferantId,
        belegdatum,
        belegtext: belegtext || undefined,
        positionen,
        verbuchen: true,
      });
      navigate(`/${mandant.id}/kreditoren`, { state: { created: beleg.beleg_nr } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800';

  return (
    <form onSubmit={speichern} className="mx-auto max-w-4xl">
      <h1 className="mb-4 text-xl font-semibold">Rechnung erfassen</h1>

      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-800">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Lieferant *</label>
          <select className={inputCls} required value={lieferantId} onChange={(e) => setLieferantId(e.target.value)}>
            <option value="" disabled>– wählen –</option>
            {lieferanten.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Belegdatum *</label>
          <input className={inputCls} type="date" required value={belegdatum} onChange={(e) => setBelegdatum(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs text-slate-500">Belegtext</label>
          <input className={inputCls} value={belegtext} onChange={(e) => setBelegtext(e.target.value)} />
        </div>
      </div>

      <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-800">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Aufwandskonto</th>
              <th className="px-3 py-2">Bezeichnung</th>
              <th className="px-3 py-2">MWST</th>
              <th className="px-3 py-2 text-right">Brutto CHF</th>
              <th className="px-3 py-2 text-right">Netto</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z, i) => {
              const r = calc(z.brutto, satzOf(z.mwst_code));
              return (
                <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-700/50">
                  <td className="px-2 py-1.5">
                    <select className={inputCls} value={z.konto_nr} onChange={(e) => setZeile(i, { konto_nr: e.target.value })}>
                      <option value="">–</option>
                      {konten.map((k) => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5"><input className={inputCls} value={z.bezeichnung} onChange={(e) => setZeile(i, { bezeichnung: e.target.value })} /></td>
                  <td className="px-2 py-1.5">
                    <select className={inputCls} value={z.mwst_code} onChange={(e) => setZeile(i, { mwst_code: e.target.value })}>
                      {codes.map((c) => <option key={c.code} value={c.code}>{c.code} ({c.satz}%)</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5"><input className={`${inputCls} text-right`} inputMode="decimal" value={z.brutto} onChange={(e) => setZeile(i, { brutto: e.target.value })} /></td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{r.brutto ? chf(r.netto) : '–'}</td>
                  <td className="px-2 py-1.5 text-right">
                    {zeilen.length > 1 && (
                      <button type="button" onClick={() => setZeilen((zs) => zs.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-600">✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between p-2">
          <button type="button" onClick={() => setZeilen((zs) => [...zs, leereZeile()])} className="rounded-md px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-700">
            + Position
          </button>
          <div className="px-3 text-sm text-slate-600 dark:text-slate-300">
            Netto {chf(summen.netto)} · MWST {chf(summen.mwst)} · <span className="font-semibold">Brutto {chf(summen.brutto)}</span>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-800">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {saving ? 'Verbucht …' : 'Erfassen & verbuchen'}
        </button>
        <button type="button" onClick={() => mandant && navigate(`/${mandant.id}/kreditoren`)} className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
          Abbrechen
        </button>
      </div>
    </form>
  );
}

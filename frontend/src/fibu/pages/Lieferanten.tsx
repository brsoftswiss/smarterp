// Lieferanten: Liste + Anlegen (schlanke Neufassung der mailflow-Seite auf REST).
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useMandant } from '../state/MandantContext';
import type { Lieferant, MwstCode } from '../api/types';

const leer = { name: '', ort: '', iban: '', zahlungsbedingung_tage: 30, standard_konto_nr: '', mwst_code: 'M81', waehrung: 'CHF' };

export function Lieferanten() {
  const { mandant } = useMandant();
  const [liste, setListe] = useState<Lieferant[]>([]);
  const [codes, setCodes] = useState<MwstCode[]>([]);
  const [form, setForm] = useState({ ...leer });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suche, setSuche] = useState('');

  async function load(): Promise<void> {
    if (!mandant) return;
    const [l, c] = await Promise.all([
      api.lieferanten.list(mandant.id),
      api.mwstCodes.list(mandant.id, { aktiv: true, typ: 'vorsteuer' }),
    ]);
    setListe(l);
    setCodes(c);
  }

  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [mandant]);

  async function speichern(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!mandant) return;
    setSaving(true);
    setError(null);
    try {
      await api.lieferanten.create(mandant.id, {
        ...form,
        zahlungsbedingung_tage: Number(form.zahlungsbedingung_tage),
      });
      setForm({ ...leer });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const gefiltert = suche
    ? liste.filter((l) => `${l.name} ${l.nr}`.toLowerCase().includes(suche.toLowerCase()))
    : liste;

  const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800';

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_320px]">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Lieferanten</h1>
          <input
            className={`${inputCls} max-w-48`}
            placeholder="Suche …"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-800">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Nr.</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Ort</th>
                <th className="px-3 py-2">Zahlung</th>
                <th className="px-3 py-2">MWST</th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/50">
                  <td className="px-3 py-2 font-mono text-xs">{l.nr}</td>
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2">{l.ort ?? '–'}</td>
                  <td className="px-3 py-2">{l.zahlungsbedingung_tage} Tage</td>
                  <td className="px-3 py-2">{l.mwst_code}</td>
                </tr>
              ))}
              {gefiltert.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-slate-500">Keine Lieferanten.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-800">
        <h2 className="mb-3 font-semibold">Neuer Lieferant</h2>
        <form onSubmit={speichern} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Name *</label>
            <input className={inputCls} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Ort</label>
            <input className={inputCls} value={form.ort} onChange={(e) => setForm({ ...form, ort: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">IBAN</label>
            <input className={inputCls} value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Zahlungsziel (Tage)</label>
              <input className={inputCls} type="number" value={form.zahlungsbedingung_tage} onChange={(e) => setForm({ ...form, zahlungsbedingung_tage: Number(e.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">MWST-Code</label>
              <select className={inputCls} value={form.mwst_code} onChange={(e) => setForm({ ...form, mwst_code: e.target.value })}>
                {codes.map((c) => <option key={c.code} value={c.code}>{c.code} ({c.satz}%)</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Standard-Aufwandskonto</label>
            <input className={inputCls} placeholder="z. B. 6500" value={form.standard_konto_nr} onChange={(e) => setForm({ ...form, standard_konto_nr: e.target.value })} />
          </div>
          {error && <div className="rounded-md bg-red-100 p-2 text-xs text-red-800">{error}</div>}
          <button type="submit" disabled={saving} className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Speichert …' : 'Anlegen'}
          </button>
        </form>
      </aside>
    </div>
  );
}

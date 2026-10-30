// Kreditoren-Dashboard: Kennzahlen + Belegliste.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, chf, dateCH } from '../api/client';
import { useMandant } from '../state/MandantContext';
import type { KreditorBeleg } from '../api/types';

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-800">
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function Dashboard() {
  const { mandant } = useMandant();
  const [belege, setBelege] = useState<KreditorBeleg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mandant) return;
    setLoading(true);
    api.kreditoren.list(mandant.id)
      .then(setBelege)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [mandant]);

  const total = belege.reduce((s, b) => s + Number(b.betrag_brutto), 0);
  const offen = belege.filter((b) => b.status === 'offen');
  const offenSumme = offen.reduce((s, b) => s + Number(b.betrag_brutto), 0);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kreditoren</h1>
        <Link to="erfassen" relative="path" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          + Rechnung erfassen
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Belege gesamt" value={String(belege.length)} />
        <Kpi label="Offen" value={`${offen.length} · ${chf(offenSumme)}`} />
        <Kpi label="Summe brutto" value={chf(total)} />
      </div>

      {error && <div className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-800">{error}</div>}
      {loading ? (
        <p className="text-slate-500">Lädt …</p>
      ) : belege.length === 0 ? (
        <p className="text-slate-500">Noch keine Belege erfasst.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-800">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Beleg-Nr.</th>
                <th className="px-3 py-2">Lieferant</th>
                <th className="px-3 py-2">Datum</th>
                <th className="px-3 py-2">Fällig</th>
                <th className="px-3 py-2 text-right">Brutto</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Verbucht</th>
              </tr>
            </thead>
            <tbody>
              {belege.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 last:border-0 dark:border-slate-700/50">
                  <td className="px-3 py-2 font-mono text-xs">{b.beleg_nr}</td>
                  <td className="px-3 py-2">{b.lieferant_name}</td>
                  <td className="px-3 py-2">{dateCH(b.belegdatum)}</td>
                  <td className="px-3 py-2">{dateCH(b.faelligkeit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{chf(b.betrag_brutto)}</td>
                  <td className="px-3 py-2"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-700">{b.status}</span></td>
                  <td className="px-3 py-2">{b.verbucht ? '✓' : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

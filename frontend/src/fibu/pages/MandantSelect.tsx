// Mandanten-Auswahl (Einstieg). Leitet bei genau einem Mandanten direkt weiter.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Mandant } from '../api/types';

export function MandantSelect() {
  const navigate = useNavigate();
  const [mandanten, setMandanten] = useState<Mandant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.mandanten.list()
      .then((list) => {
        setMandanten(list);
        if (list.length === 1) navigate(`/${list[0]!.id}/kreditoren`, { replace: true });
      })
      .catch((e: Error) => setError(e.message));
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-800">
        <h1 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-100">Mandant wählen</h1>
        <p className="mb-4 text-sm text-slate-500">smarterp Fibu</p>
        {error && <div className="mb-3 rounded-md bg-red-100 p-2 text-sm text-red-800">{error}</div>}
        <ul className="space-y-2">
          {mandanten.map((m) => (
            <li key={m.id}>
              <Link to={`/${m.id}/kreditoren`} className="block rounded-md border border-slate-200 px-3 py-2 text-slate-800 hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700">
                {m.name}
              </Link>
            </li>
          ))}
          {mandanten.length === 0 && !error && <li className="text-sm text-slate-500">Lädt …</li>}
        </ul>
      </div>
    </div>
  );
}

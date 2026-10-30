// Mandanten-Kontext (Tenant). Lädt die Liste, ermittelt den aktuellen Mandanten
// aus der Route (:mandantId) und stellt ihn den Seiten über useMandant() bereit.
// Auth/Rollen folgen in M6 — vorerst kein canWrite-Gating.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Mandant } from '../api/types';

interface MandantContextValue {
  mandant: Mandant | null;
  mandanten: Mandant[];
  loading: boolean;
  error: string | null;
}

const Ctx = createContext<MandantContextValue | null>(null);

export function MandantProvider({ children }: { children: ReactNode }) {
  const { mandantId } = useParams<{ mandantId: string }>();
  const [mandanten, setMandanten] = useState<Mandant[]>([]);
  const [mandant, setMandant] = useState<Mandant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.mandanten.list()
      .then((list) => { if (active) setMandanten(list); })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!mandantId) { setMandant(null); return; }
    api.mandanten.get(mandantId)
      .then((m) => { if (active) setMandant(m); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [mandantId]);

  return <Ctx.Provider value={{ mandant, mandanten, loading, error }}>{children}</Ctx.Provider>;
}

export function useMandant(): MandantContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMandant muss innerhalb von <MandantProvider> verwendet werden');
  return v;
}

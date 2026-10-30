// REST-Datenschicht (ersetzt die frühere supabase-js-Schicht aus mailflow).
// Alle Aufrufe gehen über den Vite-Proxy an das Node-Backend unter /api.

import type {
  BelegDetail, BelegInput, Konto, KreditorBeleg, Lieferant, Mandant, MwstCode,
} from './types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError((data && data.error) || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

const get = <T>(p: string): Promise<T> => request<T>(p);
const post = <T>(p: string, body: unknown): Promise<T> => request<T>(p, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(p: string, body: unknown): Promise<T> => request<T>(p, { method: 'PATCH', body: JSON.stringify(body) });

export const api = {
  mandanten: {
    list: () => get<Mandant[]>('/mandanten'),
    get: (id: string) => get<Mandant>(`/mandanten/${id}`),
  },
  konten: {
    list: (mandantId: string, opts?: { aktiv?: boolean; typ?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.aktiv) qs.set('aktiv', '1');
      if (opts?.typ) qs.set('typ', opts.typ);
      const s = qs.toString();
      return get<Konto[]>(`/mandanten/${mandantId}/konten${s ? `?${s}` : ''}`);
    },
  },
  mwstCodes: {
    list: (mandantId: string, opts?: { aktiv?: boolean; typ?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.aktiv) qs.set('aktiv', '1');
      if (opts?.typ) qs.set('typ', opts.typ);
      const s = qs.toString();
      return get<MwstCode[]>(`/mandanten/${mandantId}/mwst-codes${s ? `?${s}` : ''}`);
    },
  },
  lieferanten: {
    list: (mandantId: string, opts?: { aktiv?: boolean; suche?: string }) => {
      const qs = new URLSearchParams();
      if (opts?.aktiv) qs.set('aktiv', '1');
      if (opts?.suche) qs.set('suche', opts.suche);
      const s = qs.toString();
      return get<Lieferant[]>(`/mandanten/${mandantId}/lieferanten${s ? `?${s}` : ''}`);
    },
    create: (mandantId: string, body: Partial<Lieferant>) =>
      post<Lieferant>(`/mandanten/${mandantId}/lieferanten`, body),
    update: (id: string, body: Partial<Lieferant>) => patch<Lieferant>(`/lieferanten/${id}`, body),
  },
  kreditoren: {
    list: (mandantId: string, opts?: { status?: string; verbucht?: '0' | '1' }) => {
      const qs = new URLSearchParams();
      if (opts?.status) qs.set('status', opts.status);
      if (opts?.verbucht) qs.set('verbucht', opts.verbucht);
      const s = qs.toString();
      return get<KreditorBeleg[]>(`/mandanten/${mandantId}/kreditoren-belege${s ? `?${s}` : ''}`);
    },
    get: (id: string) => get<BelegDetail>(`/kreditoren-belege/${id}`),
    create: (mandantId: string, body: BelegInput) =>
      post<KreditorBeleg>(`/mandanten/${mandantId}/kreditoren-belege`, body),
  },
};

/** CHF-Betrag (String aus DECIMAL) hübsch formatieren. */
export function chf(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  return new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' }).format(n);
}

/** ISO-Datum (YYYY-MM-DD) als de-CH anzeigen. */
export function dateCH(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return new Intl.DateTimeFormat('de-CH').format(d);
}

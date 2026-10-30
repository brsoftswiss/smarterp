// Minimaler ERPNext/Frappe-REST-Client für den Paritäts-Harness.
//
// Auth: bevorzugt API-Key/Secret (ENV ERPNEXT_API_KEY/ERPNEXT_API_SECRET, Token-Auth
// umgeht CSRF). Fehlen sie, wird mit Benutzer/Passwort (Default Administrator/admin)
// eingeloggt und einmalig ein API-Key erzeugt. Nichts davon wird gespeichert.

export interface ErpConfig {
  baseUrl: string;
  apiKey?: string;
  apiSecret?: string;
  user: string;
  password: string;
}

export function erpConfigFromEnv(): ErpConfig {
  return {
    baseUrl: process.env.ERPNEXT_URL ?? 'http://localhost:8081',
    apiKey: process.env.ERPNEXT_API_KEY,
    apiSecret: process.env.ERPNEXT_API_SECRET,
    user: process.env.ERPNEXT_USER ?? 'Administrator',
    password: process.env.ERPNEXT_PASSWORD ?? 'admin',
  };
}

export class ErpError extends Error {}

type Json = Record<string, unknown>;

export class ErpClient {
  private token: string | null = null;
  private cookie = '';

  constructor(private readonly cfg: ErpConfig) {}

  /** Stellt Token-Auth sicher (nutzt ENV-Keys oder erzeugt frische). */
  async connect(): Promise<void> {
    if (this.cfg.apiKey && this.cfg.apiSecret) {
      this.token = `${this.cfg.apiKey}:${this.cfg.apiSecret}`;
      return;
    }
    // Login per Benutzer/Passwort → Cookie → API-Key erzeugen.
    const r = await fetch(`${this.cfg.baseUrl}/api/method/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usr: this.cfg.user, pwd: this.cfg.password }),
    });
    if (!r.ok) throw new ErpError(`ERPNext-Login fehlgeschlagen (${r.status}). Läuft die Instanz unter ${this.cfg.baseUrl}?`);
    this.cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    const keys = (await this.rawPost('/api/method/frappe.core.doctype.user.user.generate_keys', { user: this.cfg.user })) as {
      message?: { api_key?: string; api_secret?: string };
    };
    const k = keys.message;
    if (!k?.api_key || !k?.api_secret) throw new ErpError('Konnte keinen API-Key erzeugen.');
    this.token = `${k.api_key}:${k.api_secret}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h.Authorization = `token ${this.token}`;
    else if (this.cookie) { h.Cookie = this.cookie; h['X-Frappe-CSRF-Token'] = 'None'; }
    return h;
  }

  private async rawPost(path: string, body: Json): Promise<unknown> {
    const r = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: this.cookie ? { 'Content-Type': 'application/json', Cookie: this.cookie, 'X-Frappe-CSRF-Token': 'None' } : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse(r, 'POST', path);
  }

  private async parse(r: Response, method: string, path: string): Promise<unknown> {
    const text = await r.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }
    if (!r.ok) throw new ErpError(`${method} ${path} → ${r.status}: ${JSON.stringify(json).slice(0, 500)}`);
    return json;
  }

  private async req(method: string, path: string, body?: Json): Promise<unknown> {
    const r = await fetch(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return this.parse(r, method, path);
  }

  // --- Dokument-Helfer ---------------------------------------------------

  async getDoc<T = Json>(doctype: string, name: string): Promise<T> {
    const res = (await this.req('GET', `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)) as { data: T };
    return res.data;
  }

  async exists(doctype: string, name: string): Promise<boolean> {
    try { await this.getDoc(doctype, name); return true; } catch { return false; }
  }

  async createDoc<T = Json>(doctype: string, doc: Json): Promise<T> {
    const res = (await this.req('POST', `/api/resource/${encodeURIComponent(doctype)}`, doc)) as { data: T };
    return res.data;
  }

  async updateDoc<T = Json>(doctype: string, name: string, patch: Json): Promise<T> {
    const res = (await this.req('PUT', `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, patch)) as { data: T };
    return res.data;
  }

  /** Dokument einreichen (docstatus 1). */
  async submit(doctype: string, name: string): Promise<void> {
    await this.updateDoc(doctype, name, { docstatus: 1 });
  }

  /** Dokument stornieren (docstatus 2). */
  async cancel(doctype: string, name: string): Promise<void> {
    await this.updateDoc(doctype, name, { docstatus: 2 });
  }

  async list<T = Json>(doctype: string, filters: unknown[], fields: string[], limit = 0): Promise<T[]> {
    const qs =
      `filters=${encodeURIComponent(JSON.stringify(filters))}` +
      `&fields=${encodeURIComponent(JSON.stringify(fields))}` +
      `&limit_page_length=${limit}`;
    const res = (await this.req('GET', `/api/resource/${encodeURIComponent(doctype)}?${qs}`)) as { data: T[] };
    return res.data;
  }

  /** Nicht-stornierte GL-Einträge eines Belegs. */
  async glEntries(voucherNo: string): Promise<{ account: string; debit: number; credit: number }[]> {
    return this.list(
      'GL Entry',
      [['voucher_no', '=', voucherNo], ['is_cancelled', '=', 0]],
      ['account', 'debit', 'credit'],
    );
  }

  /** get-or-create per erwartetem Dokumentnamen. */
  async ensure(doctype: string, expectedName: string, doc: Json): Promise<string> {
    if (await this.exists(doctype, expectedName)) return expectedName;
    const created = await this.createDoc<{ name: string }>(doctype, doc);
    return created.name;
  }
}

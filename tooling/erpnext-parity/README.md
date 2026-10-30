# ERPNext-Parität (§7)

ERPNext als **Vergleichs-Orakel** für die smarterp-Buchungs-Engine: dieselben
Geschäftsfälle in beiden Systemen buchen, die resultierenden **GL Entries / Salden**
normalisieren und diffen. Abweichungen sind entweder Bugs in unserer Engine oder
bewusste CH-Spezifika (dann dokumentieren).

## Instanz (Docker)

`docker-compose.yml` basiert 1:1 auf dem offiziellen `frappe_docker/pwd.yml`
(Image `frappe/erpnext:v16.53.0`), mit **einer** Anpassung: Frontend-Port
`8080 → 8081`, weil `8080` lokal vom Supabase-Stack belegt ist.

| | |
|---|---|
| UI / REST | http://localhost:8081 |
| Login | `Administrator` / `admin` |
| Site | `frontend` (wird beim ersten Start automatisch angelegt) |
| DB/Redis | nur intern im Compose-Netz, **nicht** auf den Host publiziert |

### Starten

```bash
cd tooling/erpnext-parity
docker compose up -d
```

Der Service `create-site` legt beim **ersten** Start die Site an
(`bench new-site … --install-app erpnext`). Das dauert einige Minuten. Fortschritt:

```bash
docker compose logs -f create-site      # fertig, wenn der Container mit Code 0 endet
docker compose ps                        # Status aller Services
```

Bereit, sobald `http://localhost:8081/api/method/ping` `{"message":"pong"}` liefert.

### Stoppen / Aufräumen

```bash
docker compose down       # Container weg, Daten (Volumes) bleiben
docker compose down -v    # inkl. Daten löschen (Site muss dann neu angelegt werden)
```

## Versionshinweis

Die Quelle unter `C:\Projekte\GitProjekte\erpnext` ist der `develop`-Branch
(Frappe v17-dev). Das Orakel läuft bewusst auf der **veröffentlichten** Linie
`v16.53.0`: fertige Images, stabile Accounting-Semantik. Für den ersten
Paritätsfall (Kreditoren/Purchase Invoice → GL) ist das deckungsgleich. Falls wir
später gegen `develop`-spezifisches Verhalten abgleichen müssen, bauen wir ein
eigenes Image aus der Quelle (via `frappe_docker` Layered Build).

## REST-Zugriff (für den Harness)

ERPNext-REST, Authentifizierung per API-Key/Secret (in ERPNext pro User erzeugen)
oder Basic-Auth als Administrator:

```
GET  /api/method/ping
POST /api/resource/Purchase Invoice      # Beleg anlegen (+ submit)
GET  /api/resource/GL Entry?filters=[["voucher_no","=","<name>"]]&fields=["account","debit","credit"]
```

## Harness ausführen

Der erste Paritätsfall (Kreditoren-Einkaufsrechnung) ist umgesetzt:

```bash
npm run accounting:parity -w @smarterp/backend
```

Bucht denselben Fall in beiden Systemen und vergleicht die GL-Salden:

- **ERPNext**: Purchase Invoice (2 Positionen 6500/6600, Vorsteuer 8.1 % / 2.6 %) via REST,
  submit, GL Entries lesen.
- **smarterp**: Demo-Beleg über die eigene Engine (`postKreditorenBeleg`).
- **Normalisierung**: ERPNext-Konten → CH-KMU-Nummern, Beträge als Rappen, Soll−Haben je Konto.

Code: `backend/src/accounting/parity/` — `erpnext.ts` (REST-Client), `case.ts` (Fall + Mapping),
`run.ts` (Orchestrierung). ENV optional: `ERPNEXT_URL`, `ERPNEXT_COMPANY`,
`ERPNEXT_API_KEY`/`ERPNEXT_API_SECRET`, `ERPNEXT_USER`/`ERPNEXT_PASSWORD` (Default
http://localhost:8081, Comp1, Administrator/admin).

Verifiziert: **identische Salden** — 6500 +100.00, 6600 +50.00, 1170 +9.40, 2000 −159.40.

### Mapping CH-KMU ↔ ERPNext

- Aufwand **6500/6600** → ERPNext-Konten mit gleicher `account_number` (werden bei Bedarf angelegt).
- Vorsteuer **1170** → ERPNext-VAT-Konten (VAT 8.1 % / 2.6 % / 3.8 %), **many-to-one**.
- Kreditoren **2000** → `Creditors`.

Die ERPNext-Firma (CHF, Switzerland) bringt die VAT-Konten aus dem Kontenrahmen bereits mit;
Aufwandskonten, Item-Tax-Templates, Service-Items und Lieferant legt der Harness idempotent an.

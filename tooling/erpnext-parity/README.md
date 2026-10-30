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

## Geplanter Abgleich (erster Fall)

Kreditoren-Einkaufsrechnung analog zu `backend/src/accounting/verify.ts`:

1. In ERPNext: Lieferant + Konten + Steuer-Template anlegen, Purchase Invoice buchen.
2. In smarterp: denselben Beleg über die eigene Engine verbuchen.
3. GL Entries beider Systeme auf `{konto, soll, haben}` normalisieren und diffen.

> Das Konten-/Steuer-Mapping CH-KMU ↔ ERPNext-CoA ist noch offen (§7, §9) und wird
> hier beim Aufbau des Harness definiert.

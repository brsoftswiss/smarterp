# Handoff — smarterp Fibu-App

> Architektur- und Planungsdokument. Stand: 2026-10-30.
> Dieses Dokument ist die Grundlage für die folgenden Umsetzungs-Sessions.
> **Fortschritt:** M0 (Plan), M1 (Monorepo & Skelett), M2 (Datenmodell) und M3-Kern (Buchungs-Engine,
> Kreditoren-Verbuchung) sind umgesetzt. Das ERPNext-Paritäts-Orakel läuft und der erste Abgleich
> (Kreditoren → GL) ist belegt. M4 ist angelaufen: erste Scheibe (REST-API + Kreditoren-Pages) läuft
> end-to-end — siehe §7/§8/§12.

---

## 1. Vision & Ziel

`smarterp` soll eine eigenständige **Finanzbuchhaltungs-App (Fibu)** werden.

- **Frontend**: wird aus der bestehenden **mailflow**-App extrahiert
  (`C:\Projekte\GitProjekte\Artis\mailflow\src\modules\fibu`) und von mailflow
  sowie Supabase **entkoppelt**.
- **Backend**: neu gebaut mit **Node.js** und **MariaDB**.
- **Leitidee**: Die **Buchungslogik von ERPNext nachbauen** und das eigene Backend
  **gegen eine echte ERPNext-Instanz testen** (Parität über identische Geschäftsfälle,
  Abgleich des Hauptbuch-/GL-Outputs).

### Getroffene Architektur-Entscheidungen (2026-10-30)

| Frage | Entscheidung |
|---|---|
| Frontend ↔ Backend | **Eigene REST-API**; die fibu-Datenschicht wird auf `fetch`-Calls umgeschrieben (kein Supabase-Emulator). |
| Bedeutung „ERPNext kopieren“ | **ERPNext-Accounting-Engine in Node nachbauen** (GL Entry, Journal/Payment Entry, Kontenplan, Tax). Echte ERPNext-Instanz = Vergleichs-Orakel. |
| Ergebnis dieses Durchgangs | **Nur dieses `handoff.md`** (Plan/Architektur). Umsetzung folgt. |

---

## 2. Ausgangslage (Ist-Zustand)

### 2.1 Repo `smarterp` (Ziel-Repo)
Seit **M1** ein **Monorepo** (npm-Workspaces):
- `frontend/` — React 19 + Vite 8 + TypeScript 7 + oxlint, **Tailwind v4** (`@tailwindcss/vite`),
  `/api`-Proxy auf das Backend. Inhalt noch der Vite-Demo-Scaffold (Fibu-Pages folgen in M4).
- `backend/` — Node + **Fastify** + **mysql2**, TypeScript via `tsx`, `/health`-Endpunkt,
  abhängigkeitsfreier Migrations-Runner (`schema_migrations`). Noch kein Fibu-Schema (M2).
- `docker-compose.yml` — lokale **MariaDB 11.4**.
- Der Scaffold-Commit (`e37065e`, lag nur auf lokal `main`) wurde in den Branch
  `claude/fibu-app-setup-c7b7d9` gemergt; der frühere „Worktree hinter main"-Hinweis ist erledigt.

### 2.2 Repo `mailflow` (Quelle des Frontends)
Pfad: `C:\Projekte\GitProjekte\Artis\mailflow`

Das Fibu-Modul unter `src/modules/fibu/` ist eine ausgereifte Schweizer Fibu:
- **~40 Pages** (`pages/*.jsx`) — Kreditoren, Debitoren, Bank/CAMT, MwSt, Kontenplan,
  Zahlungslauf/PAIN.001, Jahresabschluss, Hauptbuch, Auswertungen, Stammdaten.
- `components/layout/FiBuShell.jsx` + `FiBuSidebar.jsx` (eigene Shell, 6 Sektionen).
- `contexts/MandantContext.jsx` (Mandant = Tenant), `hooks/useSetupProgress.js`.
- `api/index.js` (gesamte Datenschicht gegen Supabase).
- `utils/` — CAMT-Parser, CSV-Bank-Parser, PAIN.001-Generator, Matching-Engine,
  Kontierung, PDF-Generatoren (Rechnung/Mahnung).
- `router.jsx` — gemountet unter `/fibu/*` in mailflow.

**Technik Frontend**: React **18** (nicht 19!), JSX (kein TS), **Tailwind CSS**,
`react-router-dom@6`, `lucide-react`, `recharts`, `jspdf`/`jspdf-autotable`,
`swissqrbill`, `exceljs`/`xlsx`, `fast-xml-parser`, `date-fns`, `@tanstack/react-query`,
`react-hook-form`+`zod`, u. a.

### 2.3 Backend-Logik (Ist: Supabase)
Die eigentliche Buchhaltungslogik liegt in mailflow als:
- **~60 Fibu-SQL-Migrationen** (`supabase/migrations/*fibu*.sql`, **~10'500 Zeilen PL/pgSQL**) —
  Tabellen, RLS-Policies und alle Buchungs-Prozeduren (Double-Entry, MwSt-Abrechnung,
  OP-Liste, Zahlungslauf-Lifecycle, Storno, Skonto, Kursbewertung, Jahresabschluss …).
- **9 Fibu-Edge-Functions** (`supabase/functions/fibu-*`) — KI-Buchungsvorschlag, OCR,
  Wechselkurs-Import (ESTV/BAZG), IMAP/Inbox-Verarbeitung, Nutzer-Einladung.
- Storage-Bucket `fibu-belege` (Beleg-PDFs), Auth (GoTrue/JWT), Realtime (Inbox-Count).

> Diese Migrationen sind die **wertvollste Referenz** für Datenmodell und Buchungs-
> semantik — sie werden gelesen und auf MariaDB/Node portiert bzw. mit der
> ERPNext-Logik abgeglichen.

---

## 3. Ziel-Architektur

```
smarterp/  (Monorepo-Vorschlag)
├── frontend/              # React 19 + Vite + TS (aus smarterp-Scaffold)
│   └── src/modules/fibu/  # extrahiert aus mailflow, entkoppelt
│       ├── api/           # NEU: REST-Client statt supabase-js
│       ├── pages/         # 1:1 übernommen, Imports bereinigt
│       ├── components/    # Shell + Sidebar, eigene UI-Primitives
│       ├── contexts/      # MandantContext (REST-basiert), AuthContext (neu)
│       └── utils/         # CAMT/PAIN.001/PDF — weitgehend unverändert
│
├── backend/              # Node.js REST-API
│   ├── src/
│   │   ├── routes/       # REST-Endpunkte (siehe §5)
│   │   ├── accounting/   # ERPNext-nachgebaute Buchungs-Engine (Kern)
│   │   ├── db/           # MariaDB-Zugriff (Migrations, Query-Layer)
│   │   └── auth/         # JWT-Auth, Mandant-/Rollen-Middleware
│   └── migrations/       # MariaDB-Schema (abgeleitet aus §2.3 + ERPNext)
│
└── tooling/
    └── erpnext-parity/   # Test-Harness: gleiche Buchungen in beide Systeme,
                          # GL-Abgleich smarterp ↔ ERPNext
```

### Datenfluss
`Page → fibu/api (fetch REST) → backend/routes → accounting-Engine → MariaDB`

### Mehrmandanten / Auth
- **Mandant** (`fibu_mandanten`) = Tenant. Jede Entität trägt `mandant_id`.
- Zugriff über `fibu_user_mandant_access` (user ↔ mandant, Rolle z. B. `buchhalter`).
- Heute via Supabase-**RLS** erzwungen → im Node-Backend durch **Middleware**
  (JWT → user → erlaubte Mandanten) ersetzen. Schreibrechte rollenabhängig
  (`canWrite`), analog zu heute.

---

## 4. Frontend-Extraktion: Entkopplungs-Checkliste

Beim Kopieren von `src/modules/fibu` sind folgende Fremd-Abhängigkeiten zu ersetzen:

| Heutige Abhängigkeit | Ersatz in smarterp |
|---|---|
| `@/api/supabaseClient` | Neuer REST-Client (`fibu/api/http.ts`) |
| `supabase.from().select()/.rpc()/.storage/.auth` | Fetch-Calls gegen Backend-Endpunkte |
| Supabase **Realtime** (Inbox-Count in Sidebar) | Polling oder SSE/WebSocket (Phase 2) |
| `@/components/inbox/PaperboyInbox` | Entfernen oder eigenes Inbox-Panel (optional, Phase 3) |
| `lib/AuthContext.jsx` (mailflow) | Eigener `AuthContext` (JWT) |
| `components/ui/PersonAvatar.jsx` | Eigene kleine UI-Komponente |
| `package.json`-Import für Version | Aus smarterp `package.json` |
| `window.__TAURI__`-Checks | Entfernen (kein Tauri), oder Feature-Flag |
| Tailwind-Klassen | **Tailwind in smarterp aufsetzen** (Scaffold hat es noch nicht) |
| React 18 → 19 | Prüfen (lazy/Suspense ok; ggf. kleine API-Anpassungen) |
| JSX → TS | Schrittweise; initial als `.jsx` lauffähig halten ist ok |

**Standalone-Routen** (ohne Shell/Sidebar) beibehalten:
`/<base>/bank/:mandantId` (BankAbstimmung) und `/massen-import/:mandantId`.

---

## 5. REST-API-Design (abgeleitet aus `fibu/api/index.js`)

Die bestehende Datenschicht nutzt drei Muster, die auf REST abgebildet werden:

**(a) Direkte Tabellen-Queries** → Standard-CRUD-Ressourcen:
```
GET    /api/mandanten/:id/lieferanten
POST   /api/mandanten/:id/lieferanten
PATCH  /api/lieferanten/:id
GET    /api/mandanten/:id/konten?aktiv=1
GET    /api/mandanten/:id/mwst-codes
GET    /api/mandanten/:id/kunden | /artikel | /zahlstellen | /kontierungsregeln ...
```

**(b) RPC-Funktionen** → dedizierte Aktions-Endpunkte (Kern der Buchungslogik).
Zu portierende RPCs (Namen aus `api/index.js`):
- Mandant: `fibu_create_mandant` (legt Mandant + Kontenplan + MwSt-Codes atomar an)
- Kreditoren: `…_erstellen`, `…_bearbeiten`, `…_zahlung_erfassen`, `…_storno`,
  `delete_kreditoren_beleg`, `gutschrift_verrechnen`, `skonto_buchen`, `beleg_freigeben`,
  `op_liste_kreditoren`
- Debitoren: `…_erstellen`, `…_stellen`, `entwurf_speichern`, `…_zahlung_erfassen`,
  `…_storno`, `entwurf_loeschen`, `mahnung_erstellen`
- Zahlungslauf: `erstellen`, `historie`, `positionen_get`, `rueckmelden`, `stornieren`
- Hauptbuch: `manuelle_buchung_erstellen/korrigieren/stornieren`, `buchungssperre_setzen`
- Perioden/Abschluss: `saldovortrag_lesen/speichern`, `budget_uebersicht/speichern`,
  `kursbewertung_buchen`
- Serien/Dauerbelege: `buchung_serie(n)_…`, `dauerbeleg(e)_…`
- Zahlstelle: `zahlstelle_set_standard`

→ z. B. `POST /api/mandanten/:id/kreditoren-belege` (Beleg + Positionen + Verbuchung),
`POST /api/belege/:id/zahlung`, `POST /api/belege/:id/storno`, usw.

**(c) Edge-Functions** → interne Services/Endpunkte (später, Phase 3+):
`fibu-suggest-buchung` (KI), `fibu-kassenbeleg-ocr`, `fibu-wechselkurse-import`,
Inbox-Verarbeitung, E-Mail-Versand (`le-send-via-ms365`).

**Storage**: Beleg-PDF-Upload (`fibu-belege`) → eigener Upload-Endpunkt +
Datei-Store (lokal/S3), signierte URLs ersetzen.

---

## 6. Datenmodell (MariaDB)

Quelle: die ~60 Fibu-Migrationen (`mailflow/supabase/migrations/*fibu*.sql`).
Kern-Tabellen (Präfix `fibu_`):

- **Stamm/Tenant**: `mandanten`, `user_mandant_access`, `konten` (Kontenplan),
  `mwst_codes`, `zahlstellen`, `kontierungsregeln`, `wechselkurse`
- **Kreditoren**: `lieferanten`, `kreditoren_belege`, `kreditoren_positionen`,
  `kreditoren_dauerbelege`
- **Debitoren**: `kunden`, `artikel`, `debitoren_belege`, `debitoren_positionen`,
  `debitoren_mahnungen`
- **Hauptbuch**: `buchung_belege` (Kopf), `buchungen` (Zeilen/GL), `buchung_serien`
- **Zahlungsverkehr**: `zahlungslaeufe` (inkl. `pain001_xml`)
- **Inbox**: `rechnung_inbox`

**Portierungs-Hinweise PostgreSQL → MariaDB**:
- `uuid`/`gen_random_uuid()` → `CHAR(36)` + App-seitige UUID oder `BINARY(16)`.
- `jsonb` → `JSON`. PL/pgSQL-Prozeduren → MariaDB Stored Procedures **oder**
  (bevorzugt) **Transaktionslogik in Node** (`accounting/`), damit sie testbar ist
  und mit der ERPNext-Engine verglichen werden kann.
- RLS entfällt → Mandanten-/Rollen-Filter in der API-Schicht.
- Numerische Beträge: `DECIMAL(…)` mit definierter Rundung (Rappen) festlegen.

---

## 7. ERPNext-Parität

**Ansatz**: Die Buchungs-Engine im Node-Backend bildet ERPNexts Accounting-Modell nach:
- **GL Entry** (Hauptbuch-Zeile, debit/credit) als zentrale Wahrheit.
- **Journal Entry** (manuelle Buchung), **Payment Entry** (Zahlung),
  **Sales/Purchase Invoice** (Debitoren/Kreditoren) erzeugen GL Entries.
- **Chart of Accounts**, **Tax Templates** (MwSt), **Party** (Kunde/Lieferant),
  **Fiscal Year/Period Closing** analog.

**Test-Harness** (`backend/src/accounting/parity/`, Lauf: `npm run accounting:parity`):
1. ✅ Echte ERPNext-Instanz bereitgestellt: `tooling/erpnext-parity/` (Docker, `frappe/erpnext:v16.53.0`, REST unter http://localhost:8081, Login `Administrator`/`admin`).
2. ✅ Erster Geschäftsfall (Kreditoren-Einkaufsrechnung) als Fixture definiert (`case.ts`, identisch zu `verify.ts`). Weitere Fälle (Zahlung/Skonto, Gutschrift, Storno, MwSt-Abrechnung, FW-Kursbewertung) folgen.
3. ✅ Fall in **beiden** Systemen gebucht (ERPNext Purchase Invoice via REST, smarterp via eigene Engine).
4. ✅ **GL Entries / Salden** normalisiert (ERPNext-Konten → CH-KMU) und **gedifft**.
5. Abweichungen = Bugs oder bewusste CH-Spezifika (dokumentieren) — für den ersten Fall: **keine** (identische Salden).

**Offene Punkte für die Parität** (später zu klären):
- ~~ERPNext-Version + Deployment-Weg?~~ **Erledigt**: v16.53.0 via `tooling/erpnext-parity/` (Docker). Die Quelle `C:\Projekte\GitProjekte\erpnext` ist `develop` (v17-dev) → bei Bedarf später eigenes Image daraus.
- Welche CH-Spezifika weichen bewusst von ERPNext ab (QR-Rechnung, ESTV-MwSt-Formular,
  CAMT.053/PAIN.001, Saldosteuersatz)? Diese haben in ERPNext kein 1:1-Pendant.
- Mapping des Schweizer Kontenrahmens (KMU) auf ERPNext-CoA.

---

## 8. Roadmap / Meilensteine

- **M0 — Setup** ✅ *(dieses Dokument)*
  Architektur & Plan fixiert.

- **M1 — Monorepo & Skelett** ✅
  `frontend/` + `backend/` als npm-Workspaces. Tailwind v4 im Frontend. Backend: Fastify,
  MariaDB-Verbindung (mysql2), `/health`, Migrations-Runner. MariaDB per docker-compose.
  Verifiziert: beide Builds grün, DB healthy, `/health` → `{status:ok, db:true}`.

- **M2 — Datenmodell** ✅
  Fibu-Migrationen gelesen → MariaDB-Schema (28 Kern-Tabellen, `backend/migrations/0001_fibu_core_schema.sql`).
  Idempotenter Seed-Runner (`npm run seed`) mit Testmandant inkl. CH-KMU-Kontenplan (56 Konten) + 11 MwSt-Codes.
  Verifiziert: migrate + seed grün gegen MariaDB, CHECK-Constraints greifen.

- **M3 — Buchungs-Engine (Kern)** 🟡 *(Kern + erste ERPNext-Parität erledigt)*
  GL-Modell + Double-Entry-Posting in `backend/src/accounting/`. Kreditoren-Beleg → verbuchen → GL Entries,
  1:1 aus mailflows `fibu_kreditoren_verbuchen` portiert. Verifiziert via `npm run accounting:verify`.
  ERPNext-Parität für den Kreditoren-Fall belegt (`npm run accounting:parity`, §7) — identische GL-Salden.
  Offen: weitere Paritätsfälle (Zahlung/Skonto, Gutschrift, Storno …) und der REST-Endpunkt (mit M4).

- **M4 — Frontend-Extraktion** 🟡 *(erste Scheibe end-to-end)*
  Backend-REST unter `/api` (Fastify, Port 3001): Mandanten, Kontenplan, MwSt-Codes,
  Lieferanten (CRUD), Kreditoren-Belege (Liste/Detail/Erfassen→Verbuchen).
  Frontend `frontend/src/fibu/` (React 19, Tailwind v4, react-router): schlanke REST-Datenschicht
  (ersetzt supabase-js) + Pages Dashboard, Lieferanten, Rechnung erfassen; Mandanten-Kontext.
  End-to-end verifiziert (React → Vite-Proxy → Fastify → MariaDB; Beleg erfasst + verbucht).
  Offen: weitere Pages (OP-Liste, Zahlung, Journal), Auth/Rollen (M6), QR-Scan/PDF, react-query.

- **M5 — Breite**
  Debitoren, Zahlungslauf (PAIN.001), OP-Liste, MwSt-Abrechnung, Auswertungen.
  Parity-Harness ausbauen.

- **M6 — Services**
  Auth/Rollen produktiv, Storage/Belege, KI/OCR/FX-Import (Edge-Function-Ersatz).

---

## 9. Risiken & offene Fragen

- **Umfang**: ~40 Pages + 10'500 Zeilen Buchungslogik — mehrwöchig/mehrere Sessions.
- **CH-Fibu vs. ERPNext**: nicht alles hat ein ERPNext-Pendant (QR-Bill, ESTV-Formular,
  Saldosteuersatz) → Parität nur dort sinnvoll, wo ERPNext ein Äquivalent hat.
- **Realtime**: Supabase-Realtime (Inbox-Badge) muss ersetzt werden (Polling/SSE).
- **PDF/Parser-Utils**: `swissqrbill`, `jspdf`, CAMT/PAIN.001 — laufen clientseitig,
  bleiben größtenteils, brauchen aber Datenanpassung an neue API-Shapes.
- **React 18 → 19**: Kompatibilität der Pages prüfen.
- **ERPNext-Instanz**: ~~Bereitstellung/Version offen~~ **erledigt** — v16.53.0 via `tooling/erpnext-parity/` (Docker), erster Parity-Lauf grün (§7). Quelle `…/erpnext` ist develop/v17 → ggf. später eigenes Image.

---

## 10. Wichtige Dateipfade (Referenz)

**Arbeitspfade (lokal, Windows)**
- smarterp (dieses Repo): `C:\Projekte\GitProjekte\smarterp`
- ERPNext (Parity-Orakel, §7): `C:\Projekte\GitProjekte\erpnext`
- mailflow (Quelle Frontend + Fibu-Logik): `C:\Projekte\GitProjekte\Artis\mailflow`

**Quelle (mailflow)**
- Datenschicht: `src/modules/fibu/api/index.js`
- Shell/Nav: `src/modules/fibu/components/layout/FiBuShell.jsx`, `FiBuSidebar.jsx`
- Router: `src/modules/fibu/router.jsx`
- Pages: `src/modules/fibu/pages/*.jsx`
- Utils: `src/modules/fibu/utils/*.js`
- Supabase-Client: `src/api/supabaseClient.js`
- Schema/Logik: `supabase/migrations/*fibu*.sql`
- Services: `supabase/functions/fibu-*`, `supabase/functions/le-send-via-ms365`

**Ziel (smarterp)**
- Dieses Dokument: `handoff.md`
- Scaffold: `src/`, `package.json`, `vite.config.ts` (auf `main`)

---

## 11. Nächster konkreter Schritt (M3 → M4)

1. ✅ GL-Modell (Double-Entry) + Posting in `backend/src/accounting/` (money/types/posting/kreditoren).
2. ✅ Kreditoren-Beleg → verbuchen → GL Entries (reine Engine + DB-Schicht), verifiziert (`npm run accounting:verify`).
3. ✅ ERPNext-Orakel bereitgestellt (§7, `tooling/erpnext-parity/`, v16.53.0 @ localhost:8081).
4. ✅ Parity-Harness (`backend/src/accounting/parity/`): Kreditoren-Fall in ERPNext + smarterp gebucht, GL-Salden normalisiert und gedifft → **identisch**. Konten-/Steuer-Mapping CH-KMU ↔ ERPNext definiert.
5. Weitere Paritätsfälle (Zahlung/Skonto, Gutschrift, Storno, MwSt-Abrechnung, FW-Kursbewertung).
6. REST-Endpunkt für die Kreditoren-Verbuchung (zusammen mit der M4-Frontend-Extraktion).

## 12. Änderungsprotokoll

- **2026-10-30 — M0**: `handoff.md` erstellt (Architektur & Plan).
- **2026-10-30 — M1**: Monorepo (`frontend/` + `backend/`), Tailwind v4, Fastify + mysql2 +
  `/health` + Migrations-Runner, `docker-compose.yml` (MariaDB 11.4), Root-Workspaces & Skripte.
  Scaffold-Commit in den Branch gemergt. End-to-end verifiziert.
- **2026-10-30 — M2**: MariaDB-Kernschema (28 Tabellen, `backend/migrations/0001_fibu_core_schema.sql`) aus den
  mailflow-Fibu-Migrationen portiert; idempotenter Seed-Runner (`npm run seed`) mit Testmandant,
  CH-KMU-Kontenplan (56 Konten) und 11 MwSt-Codes. migrate + seed gegen MariaDB verifiziert.
- **2026-10-30 — M3 (Kern)**: Buchungs-Engine in `backend/src/accounting/` (money/types/posting/kreditoren/index/verify),
  1:1 aus mailflows `fibu_kreditoren_verbuchen` portiert: Double-Entry-GL, Kreditoren-Beleg → Buchungen
  (Aufwand/Vorsteuer an Kreditoren 2000), atomare Buchungsnummern (BU-JJJJ-NNNNN), Methoden effektiv/Saldosteuersatz,
  Gutschrift, FW-Kurs. Verifiziert via `npm run accounting:verify` (4 GL-Zeilen, Salden ausgeglichen, idempotent).
  Offen: REST-Endpunkt + ERPNext-Parity-Harness.
- **2026-10-30 — ERPNext-Orakel (§7)**: `tooling/erpnext-parity/` (docker-compose + README), basiert auf
  frappe_docker/pwd.yml mit `frappe/erpnext:v16.53.0`, Frontend-Port 8081 (8080 = Supabase). Instanz läuft,
  REST erreichbar (ping→pong, Login Administrator/admin; frappe 16.54.0 / erpnext 16.53.0). DB/Redis nur
  Compose-intern. Nächster Schritt: Parity-Harness (Kreditoren → GL-Diff).
- **2026-10-30 — M4 (Scheibe 1)**: Backend-REST `/api` (routes/mandanten|stammdaten|kreditoren,
  Fastify, Port 3001 wegen mailflow auf 3000) + Frontend `frontend/src/fibu/` (REST-Client statt
  supabase-js, MandantContext, Shell, Pages Dashboard/Lieferanten/RechnungErfassen, Tailwind v4,
  react-router-dom). Kreditoren-Beleg über die UI erfasst → verbucht → im Dashboard sichtbar
  (React → Vite-Proxy → Fastify → MariaDB verifiziert).
- **2026-10-30 — Parity-Harness (§7)**: `backend/src/accounting/parity/` (erpnext.ts REST-Client,
  case.ts Fall+Mapping, run.ts Orchestrierung) + Skript `npm run accounting:parity`. Bucht die
  Kreditoren-Einkaufsrechnung in ERPNext (Purchase Invoice, per-Item-Vorsteuer 8.1/2.6 %) und in
  smarterp, normalisiert die GL-Salden (ERPNext-Konten → CH-KMU, beide VAT-Konten → Vorsteuer 1170)
  und difft sie: **identisch** (6500 +100.00, 6600 +50.00, 1170 +9.40, 2000 −159.40). Erste belegte
  ERPNext-Parität.

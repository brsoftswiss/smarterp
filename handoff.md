# Handoff — smarterp Fibu-App

> Architektur- und Planungsdokument. Stand: 2026-10-30.
> Dieses Dokument ist die Grundlage für die folgenden Umsetzungs-Sessions.
> **Fortschritt:** M0 (Plan) und M1 (Monorepo & Skelett) sind umgesetzt — siehe §8/§12.

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

**Test-Harness** (`tooling/erpnext-parity/`):
1. Echte ERPNext-Instanz bereitstellen (Docker/`frappe_docker`).
2. Satz von Geschäftsfällen definieren (Fixtures): Einkaufsrechnung, Zahlung mit
   Skonto, Gutschrift, Storno, MwSt-Abrechnung, Jahresabschluss, FW-Kursbewertung …
3. Jeden Fall in **beiden** Systemen buchen (ERPNext via REST-API, smarterp via eigene API).
4. Resultierende **GL Entries / Salden** normalisieren und **diffen**.
5. Abweichungen = Bugs oder bewusste CH-Spezifika (dokumentieren).

**Offene Punkte für die Parität** (später zu klären):
- ERPNext-Version + Deployment-Weg (Docker vs. bestehend)?
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

- **M2 — Datenmodell** *(als nächstes)*
  Fibu-Migrationen lesen → MariaDB-Schema (Kern-Tabellen aus §6). Seed für 1 Testmandant
  inkl. Kontenplan + MwSt-Codes.

- **M3 — Buchungs-Engine (Kern)**
  GL-Modell + Double-Entry-Posting. Kreditoren-Beleg erfassen → verbuchen → GL.
  Erste ERPNext-Parität für diesen Fall.

- **M4 — Frontend-Extraktion**
  Erste Pages (Kreditoren-Dashboard, Lieferanten, Rechnung erfassen) nach smarterp,
  Datenschicht auf REST, von Supabase/mailflow entkoppelt. End-to-end lauffähig.

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
- **ERPNext-Instanz**: Bereitstellung/Version noch offen (§7).

---

## 10. Wichtige Dateipfade (Referenz)

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

## 11. Nächster konkreter Schritt (M2 — Datenmodell)

1. Die ~60 Fibu-Migrationen (`mailflow/supabase/migrations/*fibu*.sql`) lesen und das
   Kern-Schema (§6) als erste echte MariaDB-Migrationen unter `backend/migrations/`
   ableiten (`0001_…`), inkl. der Portierungshinweise aus §6.
2. Seed für **einen Testmandanten** inkl. Kontenplan + MwSt-Codes.
3. ERPNext-Deployment/Version mit Nutzer klären (§7), damit der Parity-Harness in M3 stehen kann.

## 12. Änderungsprotokoll

- **2026-10-30 — M0**: `handoff.md` erstellt (Architektur & Plan).
- **2026-10-30 — M1**: Monorepo (`frontend/` + `backend/`), Tailwind v4, Fastify + mysql2 +
  `/health` + Migrations-Runner, `docker-compose.yml` (MariaDB 11.4), Root-Workspaces & Skripte.
  Scaffold-Commit in den Branch gemergt. End-to-end verifiziert.

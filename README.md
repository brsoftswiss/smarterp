# smarterp

Finanzbuchhaltungs-App (Fibu). Monorepo mit React-Frontend und Node.js/MariaDB-Backend.

Architektur, Plan und Meilensteine: siehe [`handoff.md`](./handoff.md).

## Struktur

```
frontend/   React 19 + Vite + TypeScript (+ Tailwind)
backend/    Node.js (Fastify) + MariaDB (mysql2)
docker-compose.yml   lokale MariaDB
```

## Voraussetzungen

- Node.js 20+ (empfohlen 24)
- Docker Desktop (für die lokale MariaDB)

## Schnellstart

```bash
# 1) Abhängigkeiten installieren (npm workspaces, im Repo-Root)
npm install

# 2) MariaDB starten
npm run db:up

# 3) Backend-Env anlegen
cp backend/.env.example backend/.env   # Windows: copy backend\.env.example backend\.env

# 4) Migrationen anwenden (legt schema_migrations an; Fibu-Schema folgt in M2)
npm run migrate

# 5) Entwicklung starten (zwei Terminals)
npm run dev:backend    # http://localhost:3000/health
npm run dev:frontend   # http://localhost:5173  (/api → Backend-Proxy)
```

## Nützliche Skripte (Root)

| Skript | Zweck |
|---|---|
| `npm run dev:frontend` | Vite-Dev-Server |
| `npm run dev:backend` | Fastify mit Auto-Reload (tsx) |
| `npm run build` | Frontend + Backend bauen |
| `npm run db:up` / `db:down` | MariaDB starten/stoppen |
| `npm run migrate` | DB-Migrationen anwenden |

# MariaDB-Migrationen

SQL-Dateien, die der Runner (`backend/src/db/migrate.ts`) der Reihe nach anwendet.

- Namensschema: `0001_beschreibung.sql`, `0002_…` (lexikografisch sortiert).
- Jede Datei läuft in einer eigenen Transaktion und wird in `schema_migrations`
  protokolliert; angewendete Dateien werden nicht erneut ausgeführt.
- Dateien **nicht** nachträglich ändern — stattdessen eine neue Migration anlegen.

Ausführen: `npm run migrate` (im Repo-Root) oder `npm run migrate -w @smarterp/backend`.

> Das eigentliche Fibu-Datenmodell folgt in Meilenstein **M2** (siehe `handoff.md`).

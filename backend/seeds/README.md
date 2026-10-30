# Seeds (Entwicklung)

SQL-Dateien mit Beispiel-/Testdaten, ausgeführt vom Seed-Runner
(`backend/src/db/seed.ts`) der Reihe nach (lexikografisch).

- Namensschema: `0001_beschreibung.sql`, `0002_…`.
- Seeds werden **nicht** in `schema_migrations` protokolliert und bei jedem
  Lauf erneut angewendet. Die SQL muss daher **idempotent** sein
  (feste UUIDs + `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE`).
- Seeds gehören **nicht** in die Migrationskette — sie sind reine Dev-Daten.

Ausführen (Schema muss vorher migriert sein):

```
npm run migrate -w @smarterp/backend
npm run seed    -w @smarterp/backend
```

Aktueller Seed: `0001_testmandant.sql` — ein Testmandant
(`00000000-0000-0000-0000-000000000001`, „Testmandant AG") inkl.
CH-KMU-Kontenplan und Schweizer MwSt-Codes.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

// Minimaler, abhängigkeitsfreier Migrations-Runner:
// - liest backend/migrations/*.sql (lexikografisch sortiert)
// - führt noch nicht angewendete Dateien in einer Transaktion aus
// - protokolliert sie in der Tabelle `schema_migrations`
//
// Konvention für Dateinamen: `0001_beschreibung.sql`, `0002_...`.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

async function run(): Promise<void> {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
  });

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    let files: string[];
    try {
      files = (await readdir(MIGRATIONS_DIR))
        .filter((f) => f.endsWith('.sql'))
        .sort();
    } catch {
      files = [];
    }

    const [appliedRows] = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set((appliedRows as { name: string }[]).map((r) => r.name));

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log(`✓ No pending migrations (${files.length} already applied).`);
      return;
    }

    for (const file of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`→ Applying ${file} …`);
      await conn.beginTransaction();
      try {
        if (sql.trim()) await conn.query(sql);
        await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
        await conn.commit();
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await conn.rollback();
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }

    console.log(`✓ Applied ${pending.length} migration(s).`);
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

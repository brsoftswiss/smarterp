import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

// Seed-Runner (Entwicklung): fuehrt backend/seeds/*.sql (lexikografisch) aus.
// Anders als Migrationen werden Seeds NICHT in `schema_migrations` protokolliert
// und bei jedem Lauf erneut angewendet — die SQL ist daher idempotent
// (feste UUIDs + INSERT IGNORE), sodass wiederholtes Seeden nichts dupliziert.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = join(__dirname, '..', '..', 'seeds');

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
    let files: string[];
    try {
      files = (await readdir(SEEDS_DIR))
        .filter((f) => f.endsWith('.sql'))
        .sort();
    } catch {
      files = [];
    }

    if (files.length === 0) {
      console.log('✓ Keine Seed-Dateien gefunden.');
      return;
    }

    for (const file of files) {
      const sql = await readFile(join(SEEDS_DIR, file), 'utf8');
      console.log(`→ Seeding ${file} …`);
      if (sql.trim()) await conn.query(sql);
      console.log(`  ✓ ${file}`);
    }

    console.log(`✓ ${files.length} Seed-Datei(en) angewendet.`);
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

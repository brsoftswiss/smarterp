import mysql from 'mysql2/promise';
import { config } from '../config.js';

// Gemeinsamer Verbindungspool für die Anwendung.
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: 10,
  namedPlaceholders: true,
  // Beträge als String zurückgeben, damit DECIMAL-Rundung nicht durch
  // JS-Floats verfälscht wird (wichtig für Buchhaltung).
  decimalNumbers: false,
});

export async function ping(): Promise<boolean> {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return Array.isArray(rows) && (rows[0] as { ok: number }).ok === 1;
}

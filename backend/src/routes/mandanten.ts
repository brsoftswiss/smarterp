// Mandanten-Endpunkte (Tenant-Auswahl). Auth/Rollen folgen in M6; vorerst offen.
import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';

export async function mandantenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mandanten', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, waehrung, kontenrahmen, mwst_methode, geschaeftsjahr, aktiv
         FROM fibu_mandanten
        WHERE aktiv = TRUE
        ORDER BY name`,
    );
    return rows;
  });

  app.get<{ Params: { id: string } }>('/mandanten/:id', async (req, reply) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, uid, mwst_nr, mwst_pflichtig, waehrung, kontenrahmen,
              mwst_methode, abrechnungsperiode, geschaeftsjahr, aktiv
         FROM fibu_mandanten
        WHERE id = :id`,
      { id: req.params.id },
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'Mandant nicht gefunden' });
    return rows[0];
  });
}

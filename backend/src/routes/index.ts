// Sammelt die REST-Routen unter einem gemeinsamen Präfix (siehe server.ts: /api).
// Auth/Mandanten-Middleware folgt in M6; vorerst sind die Endpunkte offen und
// skopieren über die :mandantId in der URL.
import type { FastifyInstance } from 'fastify';
import { mandantenRoutes } from './mandanten.js';
import { stammdatenRoutes } from './stammdaten.js';
import { kreditorenRoutes } from './kreditoren.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(mandantenRoutes);
  await app.register(stammdatenRoutes);
  await app.register(kreditorenRoutes);
}

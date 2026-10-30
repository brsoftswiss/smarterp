import Fastify from 'fastify';
import { config } from './config.js';
import { ping } from './db/pool.js';

const app = Fastify({ logger: true });

// Health-Check: bestätigt, dass der Prozess läuft und die DB erreichbar ist.
app.get('/health', async (_req, reply) => {
  let db = false;
  try {
    db = await ping();
  } catch (err) {
    app.log.error(err);
  }
  reply.code(db ? 200 : 503).send({
    status: db ? 'ok' : 'degraded',
    db,
    time: new Date().toISOString(),
  });
});

async function start(): Promise<void> {
  try {
    await app.listen({ port: config.http.port, host: config.http.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

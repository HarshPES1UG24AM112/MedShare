import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { prisma } from './db/prisma.js';
import { startScheduler } from './jobs.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  console.log(`MedShare API listening on http://localhost:${config.PORT}/api/v1 (${config.NODE_ENV})`);
});
const timer = config.JOBS_ENABLED ? startScheduler() : null;

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  if (timer) clearInterval(timer);
  server.close();
  await Promise.allSettled([pool.end(), prisma.$disconnect()]);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

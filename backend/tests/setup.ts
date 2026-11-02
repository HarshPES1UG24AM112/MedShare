import { afterAll } from 'vitest';
import { pool } from '../src/db/pool.js';
import { prisma } from '../src/db/prisma.js';

afterAll(async () => {
  await Promise.allSettled([pool.end(), prisma.$disconnect()]);
});

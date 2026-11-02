/** Runs the Prisma CLI with the repository-root .env loaded (single source of secrets). */
import { config as loadEnv } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });
const r = spawnSync('npx', ['prisma', ...process.argv.slice(2)], { stdio: 'inherit', shell: true, env: process.env });
process.exit(r.status ?? 1);

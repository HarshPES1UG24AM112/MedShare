import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { handler } from './http/helpers.js';
import * as admin from './modules/admin.routes.js';
import * as alerts from './modules/alerts.routes.js';
import * as analytics from './modules/analytics.routes.js';
import * as auth from './modules/auth.routes.js';
import * as catalogue from './modules/catalogue.routes.js';
import * as inventory from './modules/inventory.routes.js';
import * as organizations from './modules/organizations.routes.js';
import * as redistribution from './modules/redistribution.routes.js';
import * as transfers from './modules/transfers.routes.js';
import * as users from './modules/users.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: false, exposedHeaders: ['X-Request-Id'] }));
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => {
    req.requestId = req.header('X-Request-Id')?.slice(0, 64) || randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  app.get(
    '/api/v1/health',
    handler(async (_req, res) => {
      const { rows } = await pool.query("SELECT fn_now() AS now, (SELECT max(filename) FROM schema_migrations) AS migration");
      res.json({ status: 'ok', database: 'up', serverTime: rows[0].now, schema: rows[0].migration });
    }),
  );

  const api = express.Router();
  for (const m of [auth, users, organizations, catalogue, inventory, alerts, redistribution, transfers, analytics, admin]) api.use(m.router);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

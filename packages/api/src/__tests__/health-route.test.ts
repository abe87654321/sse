jest.mock('@sse/db', () => ({
  pool: { query: jest.fn() },
}));

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { pool } from '@sse/db';
import { healthHandler } from '../services/health';

const query = pool.query as jest.Mock;
const originalMode = process.env.ONTOLOGY_V2;

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('health routes', () => {
  let url: string;
  let server: Server;

  beforeAll(async () => {
    const app = express();
    app.get('/health', healthHandler);
    app.get('/healthz', healthHandler);
    ({ url, server } = await listen(app));
  });

  afterAll(async () => {
    await close(server);
  });

  beforeEach(() => {
    query.mockReset();
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.ONTOLOGY_V2;
    else process.env.ONTOLOGY_V2 = originalMode;
  });

  it.each(['/health', '/healthz'])(
    'returns 503 when v2 is on and the outbox lags more than 300s (%s)',
    async (path) => {
      process.env.ONTOLOGY_V2 = 'on';
      query.mockResolvedValue({
        rows: [{ oldest_pending_age_seconds: '301' }],
      });

      const response = await fetch(`${url}${path}`);

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        status: 'degraded',
        ontology: {
          status: 'degraded',
          outbox: { oldestPendingAgeSeconds: 301 },
          reason: 'outbox_lag',
        },
      });
      expect(query).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['/health', '/healthz'])(
    'keeps the DB-free 200 payload when v2 is off (%s)',
    async (path) => {
      process.env.ONTOLOGY_V2 = '0';

      const response = await fetch(`${url}${path}`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
      expect(query).not.toHaveBeenCalled();
    },
  );
});

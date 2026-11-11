import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { serviceTokenAuth } from '../middleware/service-auth';
import { scimRoutes } from '../routes/scim';

let url: string;
let server: Server;
let originalNodeEnv: string | undefined;
let originalScimToken: string | undefined;
let originalMdmToken: string | undefined;
let originalWebhookToken: string | undefined;

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      const { port } = instance.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server: instance });
    });
  });
}

beforeAll(async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const app = express();
  app.use(express.json());
  app.use('/scim', serviceTokenAuth('SCIM_TOKEN'), scimRoutes);
  app.use(
    '/hook',
    serviceTokenAuth('MDM_TOKEN', 'WEBHOOK_TOKEN'),
    (_req, res) => {
      res.json({ ok: true });
    }
  );
  ({ url, server } = await listen(app));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.warn as jest.Mock).mockRestore();
});

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
  originalScimToken = process.env.SCIM_TOKEN;
  originalMdmToken = process.env.MDM_TOKEN;
  originalWebhookToken = process.env.WEBHOOK_TOKEN;
});

afterEach(() => {
  restore('NODE_ENV', originalNodeEnv);
  restore('SCIM_TOKEN', originalScimToken);
  restore('MDM_TOKEN', originalMdmToken);
  restore('WEBHOOK_TOKEN', originalWebhookToken);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('service token authentication', () => {
  it('returns 401 for a wrong SCIM token', async () => {
    process.env.SCIM_TOKEN = 'expected-token';

    const response = await fetch(`${url}/scim/Schemas`, {
      headers: { authorization: 'Bearer wrong-token' },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('returns 503 in production when SCIM_TOKEN is unset', async () => {
    delete process.env.SCIM_TOKEN;
    process.env.NODE_ENV = 'production';

    const response = await fetch(`${url}/scim/Schemas`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_TOKEN_NOT_CONFIGURED' },
    });
  });

  it('allows an unset token outside production', async () => {
    delete process.env.SCIM_TOKEN;
    process.env.NODE_ENV = 'test';

    const response = await fetch(`${url}/scim/Schemas`);

    expect(response.status).toBe(200);
  });

  it('accepts the X-Service-Token header', async () => {
    process.env.SCIM_TOKEN = 'expected-token';

    const response = await fetch(`${url}/scim/Schemas`, {
      headers: { 'x-service-token': 'expected-token' },
    });

    expect(response.status).toBe(200);
  });

  it('falls back to WEBHOOK_TOKEN for the MDM webhook', async () => {
    delete process.env.MDM_TOKEN;
    process.env.WEBHOOK_TOKEN = 'webhook-token';

    const response = await fetch(`${url}/hook`, {
      headers: { authorization: 'Bearer webhook-token' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

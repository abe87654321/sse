import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import {
  captureRawBody,
  computeServiceSignature,
  serviceSignatureAuth,
} from '../service-signature';

let url: string;
let server: Server;
let originalSecret: string | undefined;
let originalNodeEnv: string | undefined;

function listen(app: express.Express): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => {
      const { port } = instance.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server: instance });
    });
  });
}

function buildApp() {
  const app = express();
  app.use(express.json({ verify: captureRawBody }));
  app.use(
    '/scim',
    serviceSignatureAuth({ source: 'scim', secretEnv: 'SCIM_SIGNING_SECRET' })
  );
  app.post('/scim/Users', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function signedHeaders(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  return {
    'content-type': 'application/json',
    'x-timestamp': String(timestamp),
    'x-signature': computeServiceSignature(secret, {
      timestamp: String(timestamp),
      method: 'POST',
      url: '/scim/Users',
      body,
    }),
  };
}

beforeAll(async () => {
  process.env.AUDIT_EVENTS = '0';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ({ url, server } = await listen(buildApp()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  (console.warn as jest.Mock).mockRestore();
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  originalSecret = process.env.SCIM_SIGNING_SECRET;
  originalNodeEnv = process.env.NODE_ENV;
  process.env.SCIM_SIGNING_SECRET = 'signing-secret';
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SCIM_SIGNING_SECRET;
  else process.env.SCIM_SIGNING_SECRET = originalSecret;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('serviceSignatureAuth', () => {
  it('accepts a valid HMAC signature', async () => {
    const body = JSON.stringify({ userName: `valid-${Date.now()}` });
    const response = await fetch(`${url}/scim/Users`, {
      method: 'POST',
      headers: signedHeaders(body, 'signing-secret'),
      body,
    });
    expect(response.status).toBe(200);
  });

  it('rejects a wrong signature', async () => {
    const body = JSON.stringify({ userName: `wrong-${Date.now()}` });
    const headers = signedHeaders(body, 'signing-secret');
    headers['x-signature'] = '0'.repeat(64);
    const response = await fetch(`${url}/scim/Users`, { method: 'POST', headers, body });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_SIGNATURE' },
    });
  });

  it('rejects a stale timestamp', async () => {
    const body = JSON.stringify({ userName: `stale-${Date.now()}` });
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const response = await fetch(`${url}/scim/Users`, {
      method: 'POST',
      headers: signedHeaders(body, 'signing-secret', stale),
      body,
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'STALE_SIGNATURE' },
    });
  });

  it('rejects a replayed signature', async () => {
    const body = JSON.stringify({ userName: `replay-${Date.now()}` });
    const headers = signedHeaders(body, 'signing-secret');
    const first = await fetch(`${url}/scim/Users`, { method: 'POST', headers, body });
    expect(first.status).toBe(200);
    const second = await fetch(`${url}/scim/Users`, { method: 'POST', headers, body });
    expect(second.status).toBe(401);
    await expect(second.json()).resolves.toMatchObject({
      error: { code: 'REPLAY_DETECTED' },
    });
  });

  it('requires signature headers when a secret is configured', async () => {
    const response = await fetch(`${url}/scim/Users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userName: 'missing' }),
    });
    expect(response.status).toBe(401);
  });

  it('passes through when no signing secret is configured outside production', async () => {
    delete process.env.SCIM_SIGNING_SECRET;
    const response = await fetch(`${url}/scim/Users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userName: `unsigned-${Date.now()}` }),
    });
    expect(response.status).toBe(200);
  });

  it('fails closed in production when no signing secret is configured', async () => {
    delete process.env.SCIM_SIGNING_SECRET;
    process.env.NODE_ENV = 'production';
    const response = await fetch(`${url}/scim/Users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userName: `prod-unsigned-${Date.now()}` }),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SIGNING_SECRET_NOT_CONFIGURED' },
    });
  });
});

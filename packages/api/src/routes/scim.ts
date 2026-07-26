import { Router, Request, Response, NextFunction } from 'express';
import { IdentityBridge } from '../services/identity-bridge';
import { pool } from '@sse/db';

const router = Router();
const bridge = new IdentityBridge();

function asyncWrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };
}

router.get('/Schemas', (_req, res) => {
  res.json({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], totalResults: 1 });
});

router.post('/Users', asyncWrap(async (req, res) => {
  const result = await bridge.syncFromScim(req.body, 'scim');
  res.status(result.created ? 201 : 200).json({ id: result.localUserId, meta: { resourceType: 'User' } });
}));

router.get('/Users/:id', asyncWrap(async (req, res) => {
  const localId = req.params.id;
  const { rows } = await pool.query(
    'SELECT u.*, im.external_id FROM users u LEFT JOIN identity_mappings im ON im.local_user_id = u.id AND im.source = $1 WHERE u.id = $2',
    ['scim', localId]
  );
  if (rows.length === 0) { res.status(404).json({ detail: 'User not found' }); return; }
  const u = rows[0];
  res.json({
    id: u.id, userName: u.phone, name: { familyName: u.name },
    emails: u.email ? [{ value: u.email }] : [], active: u.status === 'active',
    externalId: u.external_id, 'urn:sse:role': u.role, 'urn:sse:department': u.department,
  });
}));

router.get('/Users', asyncWrap(async (req, res) => {
  const filter = req.query.filter as string;
  let query = 'SELECT u.* FROM users u JOIN identity_mappings im ON im.local_user_id = u.id WHERE im.source = $1';
  const values: any[] = ['scim'];
  if (filter) {
    const match = filter.match(/userName eq "(.+)"/);
    if (match) { query += ' AND u.phone = $2'; values.push(match[1]); }
  }
  const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM (${query}) t`, values);
  const { rows } = await pool.query(query + ' LIMIT 100', values);
  res.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: parseInt(countRows[0].count, 10),
    Resources: rows.map((u: any) => ({ id: u.id, userName: u.phone, name: { familyName: u.name }, active: u.status === 'active' })),
  });
}));

export { router as scimRoutes };

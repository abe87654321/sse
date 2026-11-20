import { pool } from '@sse/db';
import { AppError } from '../middleware/error';
import { auditIdentityEvent } from './identity-audit';
import { resolveProvisionedRole, type IdentitySource } from './identity-role-policy';

export interface ScimUser {
  userName: string
  name?: { familyName?: string; givenName?: string }
  emails?: Array<{ value: string }>
  phoneNumbers?: Array<{ value: string }>
  active?: boolean
  externalId?: string
  'urn:sse:role'?: string
  'urn:sse:department'?: string
}

export interface MdmUserEvent {
  userId: string
  event: 'created' | 'updated' | 'deleted'
  data?: { name: string; phone: string; email?: string; department: string; role: string; status: string }
}

export interface ProvisioningContext {
  ip?: string
}

const USER_STATUSES = new Set(['active', 'inactive', 'disabled']);

export class IdentityBridge {
  async syncFromScim(
    user: ScimUser,
    source: string,
    context: ProvisioningContext = {}
  ): Promise<{ localUserId: string; created: boolean; role: string }> {
    const sourceName: IdentitySource = source === 'mdm' ? 'mdm' : 'scim';
    const externalId = user.externalId || user.userName;

    try {
      if (!user.userName || typeof user.userName !== 'string') {
        throw new AppError(400, 'INVALID_PARAMS', 'SCIM userName 必填');
      }

      const { rows: existing } = await pool.query(
        `SELECT im.local_user_id, u.role FROM identity_mappings im
           JOIN users u ON u.id = im.local_user_id
          WHERE im.external_id = $1 AND im.source = $2`,
        [externalId, source]
      );

      const resolution = resolveProvisionedRole({
        source: sourceName,
        requestedRole: user['urn:sse:role'],
        currentRole: existing[0]?.role,
      });
      if (!resolution.allowed) {
        auditIdentityEvent({
          source: sourceName,
          action: 'provision',
          outcome: 'rejected',
          externalId,
          role: resolution.requestedRole,
          reason: resolution.code,
          ip: context.ip,
        });
        throw new AppError(400, resolution.code, resolution.message);
      }

      const role = resolution.role;
      const name = user.name?.familyName || user.name?.givenName || user.userName;
      const phone = user.phoneNumbers?.[0]?.value || user.userName;
      const email = user.emails?.[0]?.value;
      const department = user['urn:sse:department'] || '未分配';
      const status = user.active !== false ? 'active' : 'disabled';

      let localUserId: string;
      let created: boolean;

      if (existing.length > 0) {
        localUserId = existing[0].local_user_id;
        await pool.query(
          'UPDATE users SET name=$1, phone=$2, email=$3, department=$4, role=$5, status=$6 WHERE id=$7',
          [name, phone, email || null, department, role, status, localUserId]
        );
        await pool.query(
          'UPDATE identity_mappings SET last_synced_at=NOW() WHERE local_user_id=$1 AND source=$2',
          [localUserId, source]
        );
        created = false;
      } else {
        const { rows: inserted } = await pool.query(
          `INSERT INTO users (name, phone, email, department, role, status, password_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [name, phone, email || null, department, role, status, '!']
        );
        localUserId = inserted[0].id;
        created = true;

        await pool.query(
          'INSERT INTO identity_mappings (local_user_id, external_id, source) VALUES ($1,$2,$3)',
          [localUserId, externalId, source]
        );

        await syncUserToOntology({ id: localUserId, name, phone, department }, 'scim', externalId);
      }

      auditIdentityEvent({
        source: sourceName,
        action: created ? 'create' : 'update',
        outcome: 'success',
        externalId,
        localUserId,
        role,
        ip: context.ip,
      });

      return { localUserId, created, role };
    } catch (error) {
      if (!(error instanceof AppError)) {
        auditIdentityEvent({
          source: sourceName,
          action: 'provision',
          outcome: 'error',
          externalId,
          reason: 'internal_error',
          ip: context.ip,
        });
      }
      throw error;
    }
  }

  async syncFromMdmEvent(
    event: MdmUserEvent,
    context: ProvisioningContext = {}
  ): Promise<{ localUserId?: string; role?: string }> {
    const externalId = event.userId;

    try {
      if (!externalId || typeof externalId !== 'string') {
        throw new AppError(400, 'INVALID_PARAMS', 'MDM userId 必填');
      }
      if (!['created', 'updated', 'deleted'].includes(event.event)) {
        throw new AppError(400, 'INVALID_PARAMS', '不支持的 MDM 事件类型');
      }

      const { rows } = await pool.query(
        `SELECT im.local_user_id, u.role FROM identity_mappings im
           JOIN users u ON u.id = im.local_user_id
          WHERE im.external_id = $1 AND im.source = $2`,
        [externalId, 'mdm']
      );

      if (event.event === 'deleted') {
        if (rows.length > 0) {
          await pool.query(
            `UPDATE users SET status = 'disabled'
              WHERE id IN (
                SELECT local_user_id FROM identity_mappings
                 WHERE external_id = $1 AND source = 'mdm'
              )`,
            [externalId]
          );
        }
        auditIdentityEvent({
          source: 'mdm',
          action: 'disable',
          outcome: 'success',
          externalId,
          localUserId: rows[0]?.local_user_id,
          role: rows[0]?.role,
          ip: context.ip,
        });
        return { localUserId: rows[0]?.local_user_id, role: rows[0]?.role };
      }

      const d = event.data;
      if (!d || !d.name || !d.phone || !d.department) {
        throw new AppError(400, 'INVALID_PARAMS', 'MDM 事件缺少用户字段');
      }
      if (!USER_STATUSES.has(d.status)) {
        throw new AppError(400, 'INVALID_PARAMS', 'MDM 用户状态无效');
      }

      const resolution = resolveProvisionedRole({
        source: 'mdm',
        requestedRole: d.role,
        currentRole: rows[0]?.role,
      });
      if (!resolution.allowed) {
        auditIdentityEvent({
          source: 'mdm',
          action: 'provision',
          outcome: 'rejected',
          externalId,
          role: resolution.requestedRole,
          reason: resolution.code,
          ip: context.ip,
        });
        throw new AppError(400, resolution.code, resolution.message);
      }

      const role = resolution.role;

      if (rows.length > 0) {
        await pool.query(
          `UPDATE users SET name=$1, phone=$2, email=$3, department=$4, role=$5, status=$6
           WHERE id IN (SELECT local_user_id FROM identity_mappings WHERE external_id = $7 AND source = $8)`,
          [d.name, d.phone, d.email || null, d.department, role, d.status, externalId, 'mdm']
        );
        await syncUserToOntology(
          { id: rows[0].local_user_id, name: d.name, phone: d.phone, department: d.department },
          'mdm_service',
          externalId
        );
        auditIdentityEvent({
          source: 'mdm',
          action: 'update',
          outcome: 'success',
          externalId,
          localUserId: rows[0].local_user_id,
          role,
          ip: context.ip,
        });
        return { localUserId: rows[0].local_user_id, role };
      }

      const { rows: created } = await pool.query(
        `INSERT INTO users (name, phone, email, department, role, status, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6,'!') RETURNING id`,
        [d.name, d.phone, d.email || null, d.department, role, d.status]
      );
      await pool.query(
        'INSERT INTO identity_mappings (local_user_id, external_id, source) VALUES ($1,$2,$3)',
        [created[0].id, externalId, 'mdm']
      );
      await syncUserToOntology(
        { id: created[0].id, name: d.name, phone: d.phone, department: d.department },
        'mdm_service',
        externalId
      );
      auditIdentityEvent({
        source: 'mdm',
        action: 'create',
        outcome: 'success',
        externalId,
        localUserId: created[0].id,
        role,
        ip: context.ip,
      });
      return { localUserId: created[0].id, role };
    } catch (error) {
      if (!(error instanceof AppError)) {
        auditIdentityEvent({
          source: 'mdm',
          action: 'provision',
          outcome: 'error',
          externalId,
          reason: 'internal_error',
          ip: context.ip,
        });
      }
      throw error;
    }
  }
}

async function syncUserToOntology(user: { id: string; name: string; phone: string; department: string }, source: string, externalId?: string) {
  try {
    const { getEngine } = await import('../routes/ontology-helpers');
    const engine = getEngine();
    const base = 'https://sse.local';
    const personUri = `${base}/person/${user.id}`;
    engine.store.addEntity(personUri, 'Person', { name: user.name, phone: user.phone, department: user.department, source, externalId: externalId || '' });
    if (user.department && user.department !== '未分配') {
      const deptUri = `${base}/dept/${user.department}`;
      engine.store.addEntity(deptUri, 'Department', { name: user.department });
      engine.store.addRelation(personUri, 'sse:belongsTo', deptUri);
    }
    await engine.store.saveToDb().catch(() => {});
    try {
      const dir = (await import('path')).join(process.cwd(), 'data', 'ontology');
      const fs = await import('fs');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await engine.store.saveToTurtle((await import('path')).join(dir, 'sse.owl'));
    } catch { /* best effort */ }
  } catch { /* ontology sync is best-effort */ }
}

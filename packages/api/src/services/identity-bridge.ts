import { pool } from '@sse/db';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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

export class IdentityBridge {
  async syncFromScim(user: ScimUser, source: string): Promise<{ localUserId: string; created: boolean }> {
    const externalId = user.externalId || user.userName;
    const { rows: existing } = await pool.query(
      'SELECT local_user_id FROM identity_mappings WHERE external_id = $1 AND source = $2',
      [externalId, source]
    );

    const name = user.name?.familyName || user.name?.givenName || user.userName;
    const phone = user.phoneNumbers?.[0]?.value || user.userName;
    const email = user.emails?.[0]?.value;
    const role = user['urn:sse:role'] || 'employee';
    const department = user['urn:sse:department'] || '未分配';
    const status = user.active !== false ? 'active' : 'disabled';

    if (existing.length > 0) {
      await pool.query(
        'UPDATE users SET name=$1, phone=$2, email=$3, department=$4, role=$5, status=$6 WHERE id=$7',
        [name, phone, email || null, department, role, status, existing[0].local_user_id]
      );
      await pool.query(
        'UPDATE identity_mappings SET last_synced_at=NOW() WHERE local_user_id=$1 AND source=$2',
        [existing[0].local_user_id, source]
      );
      return { localUserId: existing[0].local_user_id, created: false };
    }

    const { rows: created } = await pool.query(
      `INSERT INTO users (name, phone, email, department, role, status, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, phone, email || null, department, role, status, 'scim_managed_no_pwd']
    );

    await pool.query(
      'INSERT INTO identity_mappings (local_user_id, external_id, source) VALUES ($1,$2,$3)',
      [created[0].id, externalId, source]
    );

    await syncUserToOntology({ id: created[0].id, name, phone, department }, 'scim', externalId);

    return { localUserId: created[0].id, created: true };
  }

  async syncFromMdmEvent(event: MdmUserEvent): Promise<void> {
    const { rows } = await pool.query(
      'SELECT local_user_id FROM identity_mappings WHERE external_id = $1 AND source = $2',
      [event.userId, 'mdm']
    );

    if (event.event === 'deleted') {
      if (rows.length > 0) {
        await pool.query(
          `UPDATE users SET status = 'disabled' WHERE id IN (SELECT local_user_id FROM identity_mappings WHERE external_id = $1 AND source = 'mdm')`,
          [event.userId]
        );
      }
      return;
    }

    const d = event.data!;
    if (rows.length > 0) {
      await pool.query(
        `UPDATE users SET name=$1, phone=$2, email=$3, department=$4, role=$5, status=$6
         WHERE id IN (SELECT local_user_id FROM identity_mappings WHERE external_id = $7 AND source = $8)`,
        [d.name, d.phone, d.email || null, d.department, d.role, d.status, event.userId, 'mdm']
      );
      await syncUserToOntology({ id: rows[0].local_user_id, name: d.name, phone: d.phone, department: d.department }, 'mdm_service', event.userId);
      return;
    }

    const { rows: created } = await pool.query(
      `INSERT INTO users (name, phone, email, department, role, status, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,'mdm_managed_no_pwd') RETURNING id`,
      [d.name, d.phone, d.email || null, d.department, d.role, d.status]
    );
    await pool.query(
      'INSERT INTO identity_mappings (local_user_id, external_id, source) VALUES ($1,$2,$3)',
      [created[0].id, event.userId, 'mdm']
    );
    await syncUserToOntology({ id: created[0].id, name: d.name, phone: d.phone, department: d.department }, 'mdm_service', event.userId);
  }
}

async function syncUserToOntology(user: { id: string; name: string; phone: string; department: string }, source: string, externalId?: string) {
  try {
    const configPath = join(process.cwd(), 'ai-config.json');
    let endpoint = 'http://localhost:11434/v1/chat/completions';
    let model = 'llama3.2-vision';
    try {
      if (existsSync(configPath)) {
        const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
        endpoint = cfg.fillEngine?.endpoint || endpoint;
        model = cfg.fillEngine?.model || model;
      }
    } catch { /* defaults */ }

    const { OntologyEngine } = await import('@sse/ontology');
    const engine = new OntologyEngine(endpoint, model);
    engine.store.addEntity(
      `https://sse.local/person/${user.id}`,
      'Person',
      { name: user.name || '', phone: user.phone || '', department: user.department || '', source, externalId: externalId || '' }
    );
    if (user.department) {
      engine.store.addEntity(
        `https://sse.local/dept/${user.department}`,
        'Department',
        { name: user.department }
      );
      engine.store.addRelation(
        `https://sse.local/person/${user.id}`,
        'sse:belongsTo',
        `https://sse.local/dept/${user.department}`
      );
    }
    await engine.store.saveToDb().catch(() => {});
  } catch { /* ontology sync is best-effort */ }
}

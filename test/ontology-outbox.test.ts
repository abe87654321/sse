// @ts-nocheck
const dbUrl = process.env.TEST_DATABASE_URL;

(dbUrl ? describe : describe.skip)('ontology outbox', () => {
  const { Client } = require('pg');

  test('captures insert/update/delete and strips secrets and PII', async () => {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      await client.query(`UPDATE ontology_settings SET value = 'true' WHERE key = 'outbox_enabled'`);
      await client.query(`INSERT INTO users (id, name, phone, email, department, role, status, password_hash)
        VALUES ('00000000-0000-0000-0000-000000000001','Outbox Test','13800000099','a@b.com','QA','employee','active','secret')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);
      await client.query(`UPDATE users SET department = 'QA2' WHERE id = '00000000-0000-0000-0000-000000000001'`);
      await client.query(`DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000001'`);
      const { rows } = await client.query(`SELECT op, new_row, old_row FROM ontology_outbox ORDER BY id DESC LIMIT 3`);
      expect(rows.map((r: any) => r.op).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE']);
      const serialized = rows.map((r: any) => JSON.stringify({ n: r.new_row, o: r.old_row })).join('\n');
      for (const forbidden of ['password_hash', '13800000099', 'a@b.com', 'storage_key', 'storage_bucket', 'ocr_result']) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      await client.query(`UPDATE ontology_settings SET value = 'false' WHERE key = 'outbox_enabled'`).catch(() => {});
      await client.end();
    }
  });
});

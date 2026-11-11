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

  test('does not enqueue rows when the outbox gate is disabled', async () => {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    const userId = '00000000-0000-0000-0000-000000000101';
    try {
      await client.query(`UPDATE ontology_settings SET value = 'false' WHERE key = 'outbox_enabled'`);
      const before = await client.query(`SELECT COALESCE(MAX(id), 0) AS max_id FROM ontology_outbox`);
      await client.query(
        `INSERT INTO users (id, name, phone, email, department, role, status, password_hash)
         VALUES ($1, 'Gate Test', '13800000101', 'gate@example.com', 'QA', 'employee', 'active', 'secret')
         ON CONFLICT (id) DO UPDATE SET department = EXCLUDED.department`,
        [userId],
      );
      await client.query(`UPDATE users SET department = 'QA2' WHERE id = $1`, [userId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

      const after = await client.query(
        `SELECT COUNT(*)::int AS count FROM ontology_outbox WHERE id > $1`,
        [before.rows[0].max_id],
      );
      expect(after.rows[0].count).toBe(0);
    } finally {
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
      await client.query(`UPDATE ontology_settings SET value = 'true' WHERE key = 'outbox_enabled'`).catch(() => {});
      await client.end();
    }
  });

  test('strips invoice and payment receipt storage/PII fields', async () => {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    const ids = {
      user: '00000000-0000-0000-0000-000000000201',
      report: '00000000-0000-0000-0000-000000000202',
      item: '00000000-0000-0000-0000-000000000203',
      invoice: '00000000-0000-0000-0000-000000000204',
      payment: '00000000-0000-0000-0000-000000000205',
    };
    try {
      await client.query(`UPDATE ontology_settings SET value = 'true' WHERE key = 'outbox_enabled'`);
      await client.query(
        `INSERT INTO users (id, name, phone, department, role, status, password_hash)
         VALUES ($1, 'PII Test', '13800000201', 'QA', 'employee', 'active', 'secret')
         ON CONFLICT (id) DO NOTHING`,
        [ids.user],
      );
      await client.query(
        `INSERT INTO expense_reports (id, serial_no, user_id, title, total_amount, status, current_step)
         VALUES ($1, 'OUTBOX-PII-1', $2, 't', 10, 'draft', 0)
         ON CONFLICT (id) DO NOTHING`,
        [ids.report, ids.user],
      );
      await client.query(
        `INSERT INTO expense_items (id, report_id, category_id, amount, expense_date, description)
         SELECT $1, $2, id, 10, '2026-11-10', 'x' FROM expense_categories WHERE name = '交通' LIMIT 1
         ON CONFLICT (id) DO NOTHING`,
        [ids.item, ids.report],
      );
      await client.query(
        `INSERT INTO invoices (id, item_id, file_name, file_format, file_size, storage_key, storage_bucket, checksum, ocr_result, verification_result)
         VALUES ($1, $2, 'invoice.pdf', 'pdf', 10, 'secret-storage-key', 'secret-bucket', 'sum', '{"text":"secret-ocr"}'::jsonb, '{"ok":false}'::jsonb)
         ON CONFLICT (id) DO UPDATE SET storage_key = EXCLUDED.storage_key, ocr_result = EXCLUDED.ocr_result`,
        [ids.invoice, ids.item],
      );
      await client.query(
        `INSERT INTO payment_receipts (id, report_id, file_name, file_format, file_size, storage_key, storage_bucket, checksum, ocr_result, verification_result)
         VALUES ($1, $2, 'receipt.pdf', 'pdf', 10, 'secret-storage-key', 'secret-bucket', 'sum', '{"text":"secret-ocr"}'::jsonb, '{"ok":false}'::jsonb)
         ON CONFLICT (id) DO UPDATE SET storage_key = EXCLUDED.storage_key, ocr_result = EXCLUDED.ocr_result`,
        [ids.payment, ids.report],
      );

      const { rows } = await client.query(
        `SELECT new_row, old_row FROM ontology_outbox
          WHERE table_name IN ('invoices', 'payment_receipts')
            AND row_id = ANY($1::uuid[])`,
        [[ids.invoice, ids.payment]],
      );
      expect(rows.length).toBeGreaterThan(0);
      const serialized = rows.map((row: any) => JSON.stringify({ n: row.new_row, o: row.old_row })).join('\n');
      for (const forbidden of ['storage_key', 'storage_bucket', 'ocr_result', 'verification_result', 'secret-storage-key', 'secret-bucket', 'secret-ocr']) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      await client.query(`UPDATE ontology_settings SET value = 'false' WHERE key = 'outbox_enabled'`).catch(() => {});
      await client.query(`DELETE FROM payment_receipts WHERE id = $1`, [ids.payment]).catch(() => {});
      await client.query(`DELETE FROM invoices WHERE id = $1`, [ids.invoice]).catch(() => {});
      await client.query(`DELETE FROM expense_items WHERE id = $1`, [ids.item]).catch(() => {});
      await client.query(`DELETE FROM expense_reports WHERE id = $1`, [ids.report]).catch(() => {});
      await client.query(`DELETE FROM users WHERE id = $1`, [ids.user]).catch(() => {});
      await client.query(`DELETE FROM ontology_outbox WHERE row_id = ANY($1::uuid[])`, [[ids.invoice, ids.payment, ids.item, ids.report, ids.user]]).catch(() => {});
      await client.end();
    }
  });
});

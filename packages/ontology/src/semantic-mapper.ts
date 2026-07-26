import { pool } from '@sse/db';
import type { OwlStore } from './owl-store';

export class SemanticMapper {
  constructor(private store: OwlStore) {}

  async syncReportToOntology(reportId: string): Promise<void> {
    const { rows: reports } = await pool.query('SELECT * FROM expense_reports WHERE id = $1', [reportId]);
    if (reports.length === 0) return;
    const r = reports[0];

    const reportUri = `https://sse.local/report/${r.id}`;
    const userId = r.user_id;
    const { rows: users } = await pool.query('SELECT id, name, department FROM users WHERE id = $1', [userId]);
    const user = users[0];

    this.store.addEntity(reportUri, r.status === 'draft' ? 'DraftReport' : r.status === 'pending' ? 'PendingReport' : 'ApprovedReport', {
      serialNo: r.serial_no,
      title: r.title,
      amount: String(r.total_amount),
      status: r.status,
      submittedAt: r.submitted_at || r.created_at,
    });

    if (user) {
      this.store.addEntity(`https://sse.local/person/${user.id}`, 'Person', {
        name: user.name,
        department: user.department,
      });
      this.store.addEntity(reportUri, '', { submittedBy: `https://sse.local/person/${user.id}` });
    }

    const { rows: items } = await pool.query(
      `SELECT ei.*, ec.name as cat_name FROM expense_items ei LEFT JOIN expense_categories ec ON ec.id = ei.category_id WHERE ei.report_id = $1`,
      [reportId]
    );
    for (const item of items) {
      const itemUri = `https://sse.local/item/${item.id}`;
      this.store.addEntity(itemUri, 'ExpenseItem', {
        amount: String(item.amount),
        description: item.description || '',
        category: item.cat_name || '',
      });
      this.store.addEntity(reportUri, '', { containsItem: itemUri });
    }
  }

  async syncAll(): Promise<void> {
    const { rows } = await pool.query('SELECT id FROM expense_reports ORDER BY created_at DESC LIMIT 500');
    for (const row of rows) {
      await this.syncReportToOntology(row.id);
    }
  }
}

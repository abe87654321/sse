import type { ApprovalRule } from '@sse/shared';
import type { IApprovalRuleRepo } from '@sse/core';
import { pool } from '../connection';

function mapRule(row: any): ApprovalRule {
  return {
    id: row.id,
    name: row.name,
    minAmount: Number(row.min_amount),
    maxAmount: Number(row.max_amount),
    categoryIds: row.category_ids ?? undefined,
    approvalChain: row.approval_chain,
    priority: row.priority,
    isActive: row.is_active,
  };
}

export class PgApprovalRuleRepo implements IApprovalRuleRepo {
  async findActive(): Promise<ApprovalRule[]> {
    const { rows } = await pool.query(
      'SELECT * FROM approval_rules WHERE is_active = true ORDER BY priority ASC'
    );
    return rows.map(mapRule);
  }

  async findById(id: string): Promise<ApprovalRule | null> {
    const { rows } = await pool.query('SELECT * FROM approval_rules WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapRule(rows[0]);
  }

  async findAll(): Promise<ApprovalRule[]> {
    const { rows } = await pool.query('SELECT * FROM approval_rules ORDER BY priority ASC');
    return rows.map(mapRule);
  }

  async create(rule: Omit<ApprovalRule, 'id'>): Promise<ApprovalRule> {
    const { rows } = await pool.query(
      `INSERT INTO approval_rules (name, min_amount, max_amount, category_ids, approval_chain, priority, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        rule.name,
        rule.minAmount,
        rule.maxAmount,
        rule.categoryIds ?? null,
        JSON.stringify(rule.approvalChain),
        rule.priority,
        rule.isActive,
      ]
    );
    return mapRule(rows[0]);
  }

  async update(id: string, rule: Partial<ApprovalRule>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (rule.name !== undefined) { fields.push(`name = $${idx++}`); values.push(rule.name); }
    if (rule.minAmount !== undefined) { fields.push(`min_amount = $${idx++}`); values.push(rule.minAmount); }
    if (rule.maxAmount !== undefined) { fields.push(`max_amount = $${idx++}`); values.push(rule.maxAmount); }
    if (rule.categoryIds !== undefined) { fields.push(`category_ids = $${idx++}`); values.push(rule.categoryIds); }
    if (rule.approvalChain !== undefined) { fields.push(`approval_chain = $${idx++}`); values.push(JSON.stringify(rule.approvalChain)); }
    if (rule.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(rule.priority); }
    if (rule.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(rule.isActive); }

    if (fields.length === 0) return;

    values.push(id);
    await pool.query(`UPDATE approval_rules SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  }

  async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM approval_rules WHERE id = $1', [id]);
  }
}

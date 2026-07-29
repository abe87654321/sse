import type { ReasoningRule } from '@sse/shared';
import { pool } from '../connection';

function mapRule(row: any): ReasoningRule {
  return {
    id: row.id, name: row.name, description: row.description ?? undefined,
    conditions: row.conditions, conclusion: row.conclusion,
    priority: row.priority, isActive: row.is_active,
  };
}

export class PgReasoningRuleRepo {
  async findAll(): Promise<ReasoningRule[]> {
    const { rows } = await pool.query('SELECT * FROM reasoning_rules ORDER BY priority');
    return rows.map(mapRule);
  }
  async findActive(): Promise<ReasoningRule[]> {
    const { rows } = await pool.query("SELECT * FROM reasoning_rules WHERE is_active = true ORDER BY priority");
    return rows.map(mapRule);
  }
  async findById(id: string): Promise<ReasoningRule | null> {
    const { rows } = await pool.query('SELECT * FROM reasoning_rules WHERE id = $1', [id]);
    return rows.length === 0 ? null : mapRule(rows[0]);
  }
  async create(rule: Omit<ReasoningRule, 'id'>): Promise<ReasoningRule> {
    const { rows } = await pool.query(
      `INSERT INTO reasoning_rules (name, description, conditions, conclusion, priority, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [rule.name, rule.description || null, JSON.stringify(rule.conditions), JSON.stringify(rule.conclusion), rule.priority, rule.isActive]
    );
    return mapRule(rows[0]);
  }
  async update(id: string, patch: Partial<ReasoningRule>): Promise<void> {
    const fields: string[] = []; const values: any[] = []; let idx = 1;
    if (patch.name !== undefined) { fields.push(`name = $${idx++}`); values.push(patch.name); }
    if (patch.description !== undefined) { fields.push(`description = $${idx++}`); values.push(patch.description); }
    if (patch.conditions !== undefined) { fields.push(`conditions = $${idx++}`); values.push(JSON.stringify(patch.conditions)); }
    if (patch.conclusion !== undefined) { fields.push(`conclusion = $${idx++}`); values.push(JSON.stringify(patch.conclusion)); }
    if (patch.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(patch.priority); }
    if (patch.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(patch.isActive); }
    if (fields.length === 0) return; fields.push('updated_at = NOW()'); values.push(id);
    await pool.query(`UPDATE reasoning_rules SET ${fields.join(', ')} WHERE id = $${idx}`, values);
  }
  async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM reasoning_rules WHERE id = $1', [id]);
  }
}

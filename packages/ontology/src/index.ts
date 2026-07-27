export { OwlStore, type GraphNode, type GraphEdge } from './owl-store';
export { SemanticMapper } from './semantic-mapper';
export { EntityExtractor } from './entity-extractor';
export { ActionReasoner } from './action-reasoner';
export { ActionExecutor } from './action-executor';
export { NlpGenerator } from './nlp-generator';
export * from './types';

import { OwlStore } from './owl-store';
import { SemanticMapper } from './semantic-mapper';
import { EntityExtractor } from './entity-extractor';
import { ActionReasoner } from './action-reasoner';
import { ActionExecutor } from './action-executor';
import { NlpGenerator } from './nlp-generator';
import { pool } from '@sse/db';
import type { ActionResult } from './types';

export class OntologyEngine {
  public store: OwlStore;
  public mapper: SemanticMapper;
  public extractor: EntityExtractor;
  public reasoner: ActionReasoner;
  public executor: ActionExecutor;
  public nlp: NlpGenerator;

  constructor(aiEndpoint: string, aiModel: string, apiBase?: string) {
    this.store = new OwlStore();
    this.mapper = new SemanticMapper(this.store);
    this.extractor = new EntityExtractor(aiEndpoint, aiModel);
    this.reasoner = new ActionReasoner();
    this.nlp = new NlpGenerator(aiEndpoint, aiModel);
    this.executor = new ActionExecutor(apiBase);
  }

  async submitFromText(text: string, userId: string, token: string): Promise<ActionResult> {
    const extraction = await this.extractor.extractFromText(text);
    if (!extraction.amount && !extraction.person && !extraction.category) {
      return { success: false, error: { step: 'extract', code: 'EXTRACTION_EMPTY', detail: '未能从输入中提取到有效报销信息' }, notified: ['user:' + userId] };
    }

    if (extraction.person?.name) {
      const { rows } = await pool.query('SELECT id FROM users WHERE name = $1 OR phone = $1', [extraction.person.name]);
      if (rows.length > 0) extraction.person.matchedUserId = rows[0].id;
    }
    if (extraction.category) {
      const { rows } = await pool.query('SELECT id FROM expense_categories WHERE name ILIKE $1 LIMIT 1', [`%${extraction.category}%`]);
      if (rows.length > 0) extraction.categoryId = rows[0].id;
    }

    const { valid, error, dto } = await this.reasoner.reason(extraction);
    if (!valid) return { success: false, error, notified: error?.step === 'reason' && error?.code === 'COULD_NOT_RESOLVE_USER' ? ['role:admin'] : ['role:admin'] };

    const result = await this.executor.execute(dto!, extraction.person!.matchedUserId!, token);
    if (result.success && result.report_id && result.serial_no) {
      try {
        result.explanation = await this.nlp.generateExplanation(
          result.report_id, result.serial_no, dto!.title, dto!.items[0].amount, extraction.person!.name
        );
      } catch {}
      try { await this.mapper.syncReportToOntology(result.report_id); } catch {}
    }
    return result;
  }
}

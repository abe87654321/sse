import axios from 'axios';
import type { ActionResult } from './types';

export class ActionExecutor {
  private apiBase: string;

  constructor(apiBase = 'http://localhost:3000') {
    this.apiBase = apiBase;
  }

  async execute(dto: any, userId: string, token: string): Promise<ActionResult> {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    try {
      const createRes = await axios.post(`${this.apiBase}/expenses`, dto, { headers });
      const report = createRes.data;

      try {
        await axios.post(`${this.apiBase}/expenses/${report.id}/submit`, {}, { headers });
        return { success: true, report_id: report.id, serial_no: report.serialNo, explanation: `报销单 ${report.serialNo} 已创建并提交审批。`, notified: [] };
      } catch {
        return { success: false, partial: true, report_id: report.id, serial_no: report.serialNo, error: { step: 'execute', code: 'SUBMIT_FAILED', detail: '报销单已创建(草稿)，但提交审批失败。请手动提交。' }, notified: ['user:' + userId, 'role:admin'] };
      }
    } catch (err: any) {
      return { success: false, error: { step: 'execute', code: 'API_CALL_FAILED', detail: '创建报销单失败: ' + (err.response?.data?.error?.message || err.message) }, notified: ['role:admin'] };
    }
  }
}

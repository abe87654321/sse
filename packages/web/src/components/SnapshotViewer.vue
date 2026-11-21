<template>
  <div v-if="modelValue" class="snapshot-overlay" @click.self="close">
    <div class="snapshot-dialog">
      <div class="snapshot-header">
        <div>
          <h3 class="font-heading">内容快照 · {{ snapshotTypeLabel(snapshot?.snapshotType) }}</h3>
          <div class="snapshot-meta">
            <span>{{ formatSnapshotTime(snapshot?.createdAt) }}</span>
            <span v-if="snapshot?.legacy" class="badge badge-draft">历史回填</span>
            <span
              v-if="snapshot"
              class="badge"
              :class="snapshot.hashValid ? 'badge-approved' : 'badge-rejected'"
            >
              {{ snapshot.hashValid ? '哈希校验通过' : '哈希校验失败' }}
            </span>
          </div>
        </div>
        <button class="btn-secondary btn-sm" @click="close">关闭</button>
      </div>

      <div v-if="!payload" class="snapshot-loading">加载中…</div>
      <div v-else class="snapshot-body">
        <section>
          <h4>主单</h4>
          <div class="info-grid">
            <div><span class="info-label">单号</span><span class="info-value">{{ payload.report.serialNo }}</span></div>
            <div><span class="info-label">标题</span><span class="info-value">{{ payload.report.title }}</span></div>
            <div><span class="info-label">申请人</span><span class="info-value">{{ payload.report.applicantName || '-' }}</span></div>
            <div><span class="info-label">部门</span><span class="info-value">{{ payload.report.applicantDepartment || '-' }}</span></div>
            <div><span class="info-label">状态</span><span class="info-value">{{ payload.report.status }}</span></div>
            <div><span class="info-label">金额</span><span class="info-value">&yen;{{ Number(payload.report.totalAmount).toLocaleString() }}</span></div>
            <div><span class="info-label">提交时间</span><span class="info-value">{{ formatSnapshotTime(payload.report.submittedAt) }}</span></div>
            <div><span class="info-label">创建时间</span><span class="info-value">{{ formatSnapshotTime(payload.report.createdAt) }}</span></div>
          </div>
        </section>

        <section>
          <h4>费用明细</h4>
          <table class="data-table">
            <thead><tr><th>日期</th><th>类别</th><th>说明</th><th>金额</th><th>发票</th></tr></thead>
            <tbody>
              <tr v-for="item in payload.items" :key="item.id">
                <td>{{ item.expenseDate }}</td>
                <td>{{ item.categoryName || '-' }}</td>
                <td>{{ item.description || '-' }}</td>
                <td>&yen;{{ Number(item.amount).toLocaleString() }}</td>
                <td>
                  <div v-if="item.invoices.length === 0" class="text-secondary">无</div>
                  <div v-for="inv in item.invoices" :key="inv.id" class="invoice-line">
                    {{ inv.fileName }}
                    <span
                      class="badge"
                      :class="inv.verificationStatus === 'pass' ? 'badge-approved' : 'badge-pending'"
                    >
                      {{ inv.verificationStatus }}
                    </span>
                  </div>
                </td>
              </tr>
              <tr v-if="payload.items.length === 0"><td colspan="5" class="text-secondary">暂无明细</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h4>AI 核对</h4>
          <div class="info-grid">
            <div><span class="info-label">汇总状态</span><span class="info-value">{{ payload.verification.aggregateStatus }}</span></div>
            <div><span class="info-label">已确认</span><span class="info-value">{{ payload.verification.acknowledged ? '是' : '否' }}</span></div>
          </div>
        </section>

        <section>
          <h4>审批</h4>
          <div v-if="payload.approval.rule" class="rule-name">
            规则：{{ payload.approval.rule.name }}（{{ payload.approval.rule.chain.map((s: any) => s.label).join(' → ') }}）
          </div>
          <div v-else class="text-secondary">审批规则：未记录</div>
          <table class="data-table">
            <thead><tr><th>步骤</th><th>审批人</th><th>结果</th><th>意见</th><th>时间</th></tr></thead>
            <tbody>
              <tr v-for="record in payload.approval.records" :key="record.id">
                <td>{{ record.step }}</td>
                <td>{{ record.approverName || record.approverId }}</td>
                <td>{{ record.result }}</td>
                <td>{{ record.comment || '-' }}</td>
                <td>{{ formatSnapshotTime(record.approvedAt || record.stepStartedAt) }}</td>
              </tr>
              <tr v-if="payload.approval.records.length === 0"><td colspan="5" class="text-secondary">暂无审批记录</td></tr>
            </tbody>
          </table>
        </section>

        <section v-if="payload.payment">
          <h4>付款</h4>
          <div class="info-grid">
            <div><span class="info-label">付款时间</span><span class="info-value">{{ formatSnapshotTime(payload.payment.paidAt) }}</span></div>
            <div><span class="info-label">付款人</span><span class="info-value">{{ payload.payment.paidByName || payload.payment.paidBy || '-' }}</span></div>
            <div><span class="info-label">凭证号</span><span class="info-value">{{ payload.payment.paymentRef || '-' }}</span></div>
            <div><span class="info-label">备注</span><span class="info-value">{{ payload.payment.paymentComment || '-' }}</span></div>
            <div><span class="info-label">回单</span><span class="info-value">{{ payload.payment.receipt?.fileName || '-' }}</span></div>
          </div>
        </section>

        <section>
          <h4>完整性</h4>
          <p class="hash-line">schema v{{ snapshot?.schemaVersion }} · <code>{{ snapshot?.contentHash }}</code></p>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatSnapshotTime, snapshotTypeLabel } from '../utils/snapshot'

const props = defineProps<{
  modelValue: boolean
  snapshot: any | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const payload = computed(() => props.snapshot?.payload || null)

function close() {
  emit('update:modelValue', false)
}
</script>

<style scoped>
.snapshot-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.snapshot-dialog {
  background: var(--bg-card); border-radius: var(--radius-lg, 12px);
  width: min(960px, 94vw); max-height: 90vh; overflow: auto;
  padding: 20px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}
.snapshot-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.snapshot-header h3 { margin: 0 0 6px; }
.snapshot-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-muted); }
.snapshot-body section { margin-top: 20px; }
.snapshot-body h4 { margin: 0 0 10px; font-size: 0.95rem; }
.info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; }
.info-label { display: block; font-size: 0.75rem; color: var(--text-muted); }
.info-value { font-size: 0.9rem; color: var(--text-primary); }
.rule-name { font-size: 0.8rem; color: var(--accent-sky); margin-bottom: 8px; }
.invoice-line { display: flex; gap: 6px; align-items: center; font-size: 0.8rem; }
.hash-line { font-size: 0.8rem; color: var(--text-muted); word-break: break-all; }
.snapshot-loading { padding: 40px 0; text-align: center; color: var(--text-muted); }
.text-secondary { color: var(--text-muted); font-size: 0.85rem; }
</style>

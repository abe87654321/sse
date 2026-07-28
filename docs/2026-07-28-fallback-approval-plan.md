# 最简审批流程 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在审批引擎中新增兜底规则 + 同人检测降级，解决小公司一人多角色重复审批问题。

**Architecture:** ApprovalEngine 新增 `resolveApprovers()` 和 `dedupeApprovalChain()` 两个方法。提交时（expenses.ts）调用降级检测，若检测到同人则克隆规则并使用有效审批链。审批推进时（approvals.ts）同样重新检测降级，确保 `createNextStep()` / `isLastStep()` 使用有效链而非原始规则链。

**Tech Stack:** TypeScript + PostgreSQL

**Spec:** `docs/2026-07-28-fallback-approval-design.md`

---

## 文件结构

| 文件 | 变更 | 职责 |
|------|------|------|
| `packages/core/src/services/approval-engine.ts` | 修改 | 新增 dedupeApprovalChain(), resolveApprovers() |
| `packages/api/src/routes/expenses.ts` | 修改 | 提交时调用降级检测 |
| `packages/api/src/routes/approvals.ts` | 修改 | 审批推进时使用有效审批链 |

---

### Task 1: ApprovalEngine — 新增同人检测方法

**Files:**
- Modify: `packages/core/src/services/approval-engine.ts:1-76`

**Current imports (line 1-4):**
```typescript
import type { ApprovalRule, ApprovalRecord } from '@sse/shared';
import { ApprovalResult } from '@sse/shared';
import type { IApprovalRuleRepo } from '../ports/iapproval-rule-repo';
import type { IApprovalRecordRepo } from '../ports/iapproval-record-repo';
```

- [ ] **Step 1: 新增 import**

在第 4 行后添加：
```typescript
import type { IUserRepo } from '../ports/iuser-repo';
```

- [ ] **Step 2: 新增 resolveApprovers 方法**

在 `matchRule()` 方法后、`startApproval()` 前插入：

```typescript
  async resolveApprovers(
    rule: ApprovalRule,
    userRepo: IUserRepo,
    department: string,
  ): Promise<Map<number, string[]>> {
    const stepApprovers = new Map<number, string[]>();
    for (const step of rule.approvalChain) {
      if (step.assigneeId) {
        const user = await userRepo.findById(step.assigneeId);
        stepApprovers.set(step.step, user ? [user.id] : []);
      } else if (step.role) {
        const users = await userRepo.findByRole(step.role, department);
        stepApprovers.set(step.step, users.map((u) => u.id));
      } else {
        stepApprovers.set(step.step, []);
      }
    }
    return stepApprovers;
  }
```

- [ ] **Step 3: 新增 dedupeApprovalChain 方法**

在 `resolveApprovers()` 后插入：

```typescript
  async dedupeApprovalChain(
    rule: ApprovalRule,
    userRepo: IUserRepo,
    department: string,
  ): Promise<{ effectiveChain: typeof rule.approvalChain; merged: boolean }> {
    const stepApprovers = await this.resolveApprovers(rule, userRepo, department);
    const steps = rule.approvalChain;
    const merged = new Set<number>();

    // compare each later step against all previous steps
    for (let i = 1; i < steps.length; i++) {
      const currentIds = stepApprovers.get(steps[i].step) || [];
      if (currentIds.length === 0) continue;
      for (let j = 0; j < i; j++) {
        const prevIds = stepApprovers.get(steps[j].step) || [];
        if (prevIds.length === 0) continue;
        const overlap = currentIds.some((id) => prevIds.includes(id));
        if (overlap) {
          merged.add(steps[i].step);
          break; // this step is covered by an earlier step, skip further comparison
        }
      }
    }

    if (merged.size === 0) {
      return { effectiveChain: steps, merged: false };
    }

    const effectiveChain = steps.filter((s) => !merged.has(s.step));
    return { effectiveChain, merged: true };
  }
```

- [ ] **Step 4: 编译验证**

```bash
pnpm --filter @sse/core build
```

Expected: 编译通过，无类型错误

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/services/approval-engine.ts
git commit -m "feat: add resolveApprovers and dedupeApprovalChain to ApprovalEngine"
```

---

### Task 2: 提交流程 — 集成降级检测

**Files:**
- Modify: `packages/api/src/routes/expenses.ts:243-278`

- [ ] **Step 1: 导入 IUserRepo**

在文件顶部 import 中确认 `IUserRepo` 可用（当前已通过 `@sse/core` 导入相关类型）：

`expenses.ts` 当前 import（检查实际文件）：
```typescript
import { PgExpenseRepo, PgApprovalRuleRepo, PgApprovalRecordRepo, PgExpenseItemRepo, PgUserRepo, pool } from '@sse/db';
```

如果 `PgUserRepo` 未导入，在 imports 处添加：
```typescript
const userRepo = new PgUserRepo();
```

（如果已存在则跳过）

- [ ] **Step 2: 修改 POST /:id/submit 逻辑**

找到第 259-275 行的提交逻辑，在 `matchRule` 之后、`startApproval` 之前插入降级检测：

将第 259-275 行：
```typescript
    const ApprovalEngine = (await import('@sse/core')).ApprovalEngine;
    const engine = new ApprovalEngine(ruleRepo, recordRepo);
    const matchedRule = await engine.matchRule(report.totalAmount, categoryIds);

    let currentStep = 0;
    if (matchedRule && matchedRule.approvalChain.length > 0) {
      const firstStep = matchedRule.approvalChain[0];
      if (firstStep.role || firstStep.assigneeId) {
        const record = await engine.startApproval(id, matchedRule);
        currentStep = record.step;
      }
    }
```

替换为：
```typescript
    const ApprovalEngine = (await import('@sse/core')).ApprovalEngine;
    const engine = new ApprovalEngine(ruleRepo, recordRepo);
    const matchedRule = await engine.matchRule(report.totalAmount, categoryIds);

    let effectiveChain = matchedRule?.approvalChain;
    if (matchedRule && matchedRule.approvalChain.length > 1) {
      const userRepo = new PgUserRepo();
      const reporter = await userRepo.findById(report.userId);
      const dept = reporter?.department || '';
      const { effectiveChain: dedupedChain, merged } = await engine.dedupeApprovalChain(
        matchedRule, userRepo, dept
      );
      if (merged) {
        effectiveChain = dedupedChain;
        // clone rule with effective chain
        matchedRule.approvalChain = effectiveChain;
      }
    }

    let currentStep = 0;
    if (matchedRule && matchedRule.approvalChain.length > 0) {
      const firstStep = matchedRule.approvalChain[0];
      if (firstStep.role || firstStep.assigneeId) {
        const record = await engine.startApproval(id, matchedRule);
        currentStep = record.step;
      }
    }
```

- [ ] **Step 3: 编译验证**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 4: 提交**

```bash
git add packages/api/src/routes/expenses.ts
git commit -m "feat: integrate dedup detection into expense submit flow"
```

---

### Task 3: 审批推进 — 使用有效审批链

**Files:**
- Modify: `packages/api/src/routes/approvals.ts:82-149`

在审批通过流程中，`matchRule()` 返回原始规则，需要重新运行降级检测。

- [ ] **Step 1: 修改 approve 路由的规则使用**

找到第 126-148 行（approve 逻辑的后半部分），在 `matchedRule` 获取后、使用前插入降级检测：

将第 126-137 行：
```typescript
    const matchedRule = await engine.matchRule(report.totalAmount, categoryIds);
    if (!matchedRule) {
      await expenseRepo.updateStatus(reportId, ReportStatus.APPROVED);
      res.json({ message: '审批成功（无匹配规则，直接通过）', result: ApprovalResult.APPROVED });
      return;
    }

    if (engine.isLastStep(matchedRule, pendingRecord.step)) {
      await expenseRepo.updateStatus(reportId, ReportStatus.APPROVED);
      res.json({ message: '审批成功，流程结束', result: ApprovalResult.APPROVED });
      return;
    }

    const nextRecord = await engine.createNextStep(reportId, matchedRule, pendingRecord.step);
```

替换为：
```typescript
    const matchedRule = await engine.matchRule(report.totalAmount, categoryIds);
    if (!matchedRule) {
      await expenseRepo.updateStatus(reportId, ReportStatus.APPROVED);
      res.json({ message: '审批成功（无匹配规则，直接通过）', result: ApprovalResult.APPROVED });
      return;
    }

    // re-run dedup to get effective chain for in-flight reports
    if (matchedRule.approvalChain.length > 1) {
      const userRepo = new PgUserRepo();
      const reporter = await userRepo.findById(report.userId);
      const dept = reporter?.department || '';
      const { effectiveChain, merged } = await engine.dedupeApprovalChain(
        matchedRule, userRepo, dept
      );
      if (merged) {
        matchedRule.approvalChain = effectiveChain;
      }
    }

    if (engine.isLastStep(matchedRule, pendingRecord.step)) {
      await expenseRepo.updateStatus(reportId, ReportStatus.APPROVED);
      res.json({ message: '审批成功，流程结束', result: ApprovalResult.APPROVED });
      return;
    }

    const nextRecord = await engine.createNextStep(reportId, matchedRule, pendingRecord.step);
```

- [ ] **Step 2: 编译验证**

```bash
pnpm --filter @sse/api build
```

- [ ] **Step 3: 提交**

```bash
git add packages/api/src/routes/approvals.ts
git commit -m "feat: apply dedup detection on approval progression for effective chain"
```

---

### Task 4: 全量编译 + 验证

- [ ] **Step 1: 全量编译**

```bash
pnpm build
```

Expected: 所有包编译通过

- [ ] **Step 2: 手动验证场景**

1. 创建一个一人兼任"部门审批人"和"财务"的测试环境（同一部门、两个角色）
2. 提交一笔报销 → 应触发降级，只创建 1 步审批记录
3. 审批人审批 → 应直接通过，不会推进到第 2 步
4. 查看日志确认降级已生效

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore: full build verification for fallback approval dedup"
```

# SSE 报销系统 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零搭建 SSE (Smart Staff Expense) 报销管理系统，含 REST API、MCP Server、发票 OCR、通知推送、前端 SPA

**Architecture:** TypeScript monorepo (pnpm workspace)，六边形架构（Ports & Adapters），core/ 零框架依赖，api/ 和 mcp/ 为独立适配器，web/ 为 Vue 3 SPA

**Tech Stack:** Node.js + TypeScript, Express, PostgreSQL, MinIO, Vue 3 + Element Plus, PaddleOCR, pnpm workspace

---

## Task 0: 项目脚手架

**Files:**
- Create: `sse/package.json`, `sse/pnpm-workspace.yaml`, `sse/tsconfig.base.json`, `sse/.gitignore`, `sse/docker-compose.yml`
- Create: `sse/packages/shared/package.json`, `sse/packages/core/package.json`, `sse/packages/db/package.json`, `sse/packages/auth/package.json`
- Create: `sse/packages/api/package.json`, `sse/packages/mcp/package.json`, `sse/packages/ocr/package.json`, `sse/packages/notifications/package.json`, `sse/packages/web/package.json`

- [ ] **Step 1: 初始化根 package.json**

```json
{
  "name": "sse",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @sse/api dev & pnpm --filter @sse/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "migrate": "pnpm --filter @sse/db migrate",
    "migrate:rollback": "pnpm --filter @sse/db migrate:rollback"
  },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 2: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: 创建 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 4: 创建 .gitignore**

```
node_modules/
dist/
.env
*.log
.superpowers/
uploads/
```

- [ ] **Step 5: 创建 docker-compose.yml**

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: sse
      POSTGRES_USER: sse
      POSTGRES_PASSWORD: sse_dev
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ['9000:9000', '9001:9001']
    volumes: ['miniodata:/data']

volumes:
  pgdata:
  miniodata:
```

- [ ] **Step 6: 为每个包创建 package.json**

`packages/shared/package.json`:
```json
{
  "name": "@sse/shared",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "jest" },
  "dependencies": {},
  "devDependencies": { "typescript": "^5.3" }
}
```

`packages/core/package.json`:
```json
{
  "name": "@sse/core",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "jest" },
  "dependencies": { "@sse/shared": "workspace:*" },
  "devDependencies": { "typescript": "^5.3", "jest": "^29", "ts-jest": "^29" }
}
```

`packages/db/package.json`:
```json
{
  "name": "@sse/db",
  "version": "0.1.0",
  "scripts": { "build": "tsc", "migrate": "node dist/migrate.js up", "migrate:rollback": "node dist/migrate.js down" },
  "dependencies": { "@sse/core": "workspace:*", "pg": "^8.11" },
  "devDependencies": { "@types/pg": "^8.10", "typescript": "^5.3" }
}
```

- [ ] **Step 7: 安装依赖**

Run: `pnpm install`

- [ ] **Step 8: 启动 Docker 环境验证**

Run: `docker-compose up -d`
Expected: `pg_isready -h localhost -p 5432` 返回 accepting connections

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "chore: scaffold monorepo project structure"
```

---

## Task 1: shared/ — 共享类型定义

**Files:**
- Create: `sse/packages/shared/src/enums/report-status.ts`
- Create: `sse/packages/shared/src/enums/user-role.ts`
- Create: `sse/packages/shared/src/enums/approval-result.ts`
- Create: `sse/packages/shared/src/enums/invoice-format.ts`
- Create: `sse/packages/shared/src/enums/notification-channel.ts`
- Create: `sse/packages/shared/src/enums/notification-trigger.ts`
- Create: `sse/packages/shared/src/enums/notification-status.ts`
- Create: `sse/packages/shared/src/enums/index.ts`
- Create: `sse/packages/shared/src/types/user.ts`
- Create: `sse/packages/shared/src/types/expense-report.ts`
- Create: `sse/packages/shared/src/types/expense-item.ts`
- Create: `sse/packages/shared/src/types/invoice.ts`
- Create: `sse/packages/shared/src/types/approval-rule.ts`
- Create: `sse/packages/shared/src/types/approval-record.ts`
- Create: `sse/packages/shared/src/types/notification-log.ts`
- Create: `sse/packages/shared/src/types/index.ts`
- Create: `sse/packages/shared/src/dto/index.ts`
- Create: `sse/packages/shared/src/index.ts`
- Create: `sse/packages/shared/tsconfig.json`

- [ ] **Step 1: 创建枚举**

`enums/report-status.ts`:
```typescript
export enum ReportStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
}
```

`enums/user-role.ts`:
```typescript
export enum UserRole {
  EMPLOYEE = 'employee',
  DEPT_APPROVER = 'dept_approver',
  FINANCE = 'finance',
  ADMIN = 'admin',
}
```

`enums/approval-result.ts`:
```typescript
export enum ApprovalResult {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PENDING = 'pending',
}
```

`enums/invoice-format.ts`:
```typescript
export enum InvoiceFormat {
  PDF = 'pdf',
  OFD = 'ofd',
}
```

`enums/notification-channel.ts`:
```typescript
export enum NotificationChannel {
  SMS = 'sms',
  EMAIL = 'email',
}
```

`enums/notification-trigger.ts`:
```typescript
export enum NotificationTriggerType {
  APPROVAL_REMINDER = 'approval_reminder',
  ESCALATION = 'escalation',
  REJECTED = 'rejected',
  PAID = 'paid',
}
```

`enums/notification-status.ts`:
```typescript
export enum NotificationStatus {
  SENT = 'sent',
  FAILED = 'failed',
  PENDING = 'pending',
}
```

`enums/index.ts`:
```typescript
export { ReportStatus } from './report-status';
export { UserRole } from './user-role';
export { ApprovalResult } from './approval-result';
export { InvoiceFormat } from './invoice-format';
export { NotificationChannel } from './notification-channel';
export { NotificationTriggerType } from './notification-trigger';
export { NotificationStatus } from './notification-status';
```

- [ ] **Step 2: 创建实体类型**

`types/user.ts`:
```typescript
export interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  department: string;
  role: 'employee' | 'dept_approver' | 'finance' | 'admin';
  parentId?: string;
  status: 'active' | 'disabled';
  createdAt: Date;
  updatedAt: Date;
}
```

`types/expense-report.ts`:
```typescript
import { ReportStatus } from '../enums';

export interface ExpenseReport {
  id: string;
  serialNo: string;
  userId: string;
  title: string;
  totalAmount: number;
  status: ReportStatus;
  currentStep: number;
  submittedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

`types/expense-item.ts`:
```typescript
export interface ExpenseItem {
  id: string;
  reportId: string;
  categoryId: string;
  amount: number;
  expenseDate: string;
  description: string;
}
```

`types/invoice.ts`:
```typescript
import { InvoiceFormat } from '../enums';

export interface OcrResult {
  invoiceNo?: string;
  amount?: number;
  taxAmount?: number;
  totalAmount?: number;
  invoiceDate?: string;
  sellerName?: string;
  buyerName?: string;
  status: string;
}

export interface Invoice {
  id: string;
  itemId: string;
  fileName: string;
  fileFormat: InvoiceFormat;
  fileSize: number;
  storageKey: string;
  storageBucket: string;
  checksum: string;
  ocrResult?: OcrResult;
  uploadedAt: Date;
}
```

`types/approval-rule.ts`:
```typescript
export interface ApprovalChainStep {
  step: number;
  role: string;
  label: string;
  reminderAfterHours?: number;
  escalateAfterHours?: number;
  escalateTo?: string;
}

export interface ApprovalRule {
  id: string;
  name: string;
  minAmount: number;
  maxAmount: number;
  categoryIds?: string[];
  approvalChain: ApprovalChainStep[];
  priority: number;
  isActive: boolean;
}
```

`types/approval-record.ts`:
```typescript
import { ApprovalResult } from '../enums';

export interface ApprovalRecord {
  id: string;
  reportId: string;
  step: number;
  approverId: string;
  stepStartedAt: Date;
  result: ApprovalResult;
  comment?: string;
  approvedAt?: Date;
  reminderSentAt?: Date;
  escalatedAt?: Date;
}
```

`types/notification-log.ts`:
```typescript
import { NotificationChannel, NotificationTriggerType, NotificationStatus } from '../enums';

export interface NotificationLog {
  id: string;
  reportId: string;
  recipientId: string;
  channel: NotificationChannel;
  triggerType: NotificationTriggerType;
  status: NotificationStatus;
  sentAt?: Date;
  errorMessage?: string;
}
```

`types/index.ts`:
```typescript
export type { User } from './user';
export type { ExpenseReport } from './expense-report';
export type { ExpenseItem } from './expense-item';
export type { Invoice, OcrResult } from './invoice';
export type { ApprovalRule, ApprovalChainStep } from './approval-rule';
export type { ApprovalRecord } from './approval-record';
export type { NotificationLog } from './notification-log';
```

- [ ] **Step 3: 创建 DTO 类型**

`dto/index.ts`:
```typescript
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginationResult {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface ApiError {
  code: 'NOT_FOUND' | 'INVALID_PARAMS' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'INTERNAL_ERROR';
  message: string;
  retryAfterSeconds?: number;
}

export interface PaginatedResponse<T> {
  results: T[];
  pagination: PaginationResult;
}

export interface CreateReportDto {
  title: string;
  items: Array<{
    categoryId: string;
    amount: number;
    expenseDate: string;
    description: string;
  }>;
}

export interface SearchExpensesQuery extends PaginationParams {
  dateFrom?: string;
  dateTo?: string;
  applicantId?: string;
  status?: string;
  categoryId?: string;
  amountMin?: number;
  amountMax?: number;
  keyword?: string;
}

export interface StatisticsQuery {
  dateFrom?: string;
  dateTo?: string;
  department?: string;
}
```

`shared/src/index.ts`:
```typescript
export * from './enums';
export * from './types';
export * from './dto';
```

- [ ] **Step 4: 创建 tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 5: 构建验证**

Run: `pnpm --filter @sse/shared build`
Expected: 编译成功，dist/ 目录生成

- [ ] **Step 6: 提交**

```bash
git add packages/shared/
git commit -m "feat(shared): add all enums, entity types, and DTO definitions"
```

---

## Task 2: core/ — 端口接口定义

**Files:**
- Create: `sse/packages/core/src/ports/iexpense-repo.ts`
- Create: `sse/packages/core/src/ports/iuser-repo.ts`
- Create: `sse/packages/core/src/ports/iinvoice-repo.ts`
- Create: `sse/packages/core/src/ports/iapproval-rule-repo.ts`
- Create: `sse/packages/core/src/ports/iapproval-record-repo.ts`
- Create: `sse/packages/core/src/ports/inotification-log-repo.ts`
- Create: `sse/packages/core/src/ports/iocr-service.ts`
- Create: `sse/packages/core/src/ports/inotification-service.ts`
- Create: `sse/packages/core/src/ports/ifile-storage.ts`
- Create: `sse/packages/core/src/ports/index.ts`
- Create: `sse/packages/core/tsconfig.json`

- [ ] **Step 1: 创建仓储接口**

`ports/iexpense-repo.ts`:
```typescript
import type { ExpenseReport, CreateReportDto } from '@sse/shared';

export interface ExpenseQuery {
  dateFrom?: string;
  dateTo?: string;
  applicantId?: string;
  status?: string;
  categoryId?: string;
  amountMin?: number;
  amountMax?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface IExpenseRepo {
  findById(id: string): Promise<ExpenseReport | null>;
  findMany(query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }>;
  findManyByApprover(approverId: string, page: number, pageSize: number): Promise<{ results: ExpenseReport[]; total: number }>;
  findManyByUser(userId: string, query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }>;
  create(dto: CreateReportDto, userId: string, serialNo: string): Promise<ExpenseReport>;
  updateStatus(id: string, status: string, currentStep?: number): Promise<void>;
  getStatistics(dateFrom?: string, dateTo?: string, department?: string): Promise<any>;
  getUserSummary(userId: string, dateFrom?: string, dateTo?: string): Promise<any>;
}
```

`ports/iuser-repo.ts`:
```typescript
import type { User } from '@sse/shared';

export interface IUserRepo {
  findById(id: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findDeptApprovers(department: string): Promise<User[]>;
  findAll(): Promise<User[]>;
}
```

`ports/iinvoice-repo.ts`:
```typescript
import type { Invoice } from '@sse/shared';

export interface IInvoiceRepo {
  findById(id: string): Promise<Invoice | null>;
  findByItemId(itemId: string): Promise<Invoice | null>;
  create(invoice: Omit<Invoice, 'id' | 'uploadedAt'>): Promise<Invoice>;
  updateOcrResult(id: string, ocrResult: any): Promise<void>;
}
```

`ports/iapproval-rule-repo.ts`:
```typescript
import type { ApprovalRule } from '@sse/shared';

export interface IApprovalRuleRepo {
  findActive(): Promise<ApprovalRule[]>;
  findById(id: string): Promise<ApprovalRule | null>;
  findAll(): Promise<ApprovalRule[]>;
  create(rule: Omit<ApprovalRule, 'id'>): Promise<ApprovalRule>;
  update(id: string, rule: Partial<ApprovalRule>): Promise<void>;
  delete(id: string): Promise<void>;
}
```

`ports/iapproval-record-repo.ts`:
```typescript
import type { ApprovalRecord } from '@sse/shared';

export interface IApprovalRecordRepo {
  findByReportId(reportId: string): Promise<ApprovalRecord[]>;
  findPendingOverdue(): Promise<ApprovalRecord[]>;
  create(record: Omit<ApprovalRecord, 'id'>): Promise<ApprovalRecord>;
  updateResult(id: string, result: string, comment?: string): Promise<void>;
  markReminderSent(id: string): Promise<void>;
  markEscalated(id: string): Promise<void>;
}
```

`ports/inotification-log-repo.ts`:
```typescript
import type { NotificationLog } from '@sse/shared';

export interface INotificationLogRepo {
  create(log: Omit<NotificationLog, 'id'>): Promise<NotificationLog>;
  findByReportId(reportId: string): Promise<NotificationLog[]>;
  findByRecipient(recipientId: string, page: number, pageSize: number): Promise<{ results: NotificationLog[]; total: number }>;
}
```

`ports/iocr-service.ts`:
```typescript
import type { OcrResult } from '@sse/shared';

export interface IOcrService {
  parsePdf(fileBuffer: Buffer): Promise<OcrResult>;
  parseOfd(fileBuffer: Buffer): Promise<OcrResult>;
}
```

`ports/inotification-service.ts`:
```typescript
export interface INotificationService {
  sendSms(phone: string, content: string): Promise<boolean>;
  sendEmail(email: string, subject: string, body: string): Promise<boolean>;
}
```

`ports/ifile-storage.ts`:
```typescript
export interface IFileStorage {
  upload(key: string, bucket: string, data: Buffer, contentType: string): Promise<void>;
  getSignedUrl(key: string, bucket: string, expiresInSeconds: number): Promise<string>;
  getObject(key: string, bucket: string): Promise<Buffer>;
  calculateChecksum(data: Buffer): string;
}
```

`ports/index.ts`:
```typescript
export type { ExpenseQuery, IExpenseRepo } from './iexpense-repo';
export type { IUserRepo } from './iuser-repo';
export type { IInvoiceRepo } from './iinvoice-repo';
export type { IApprovalRuleRepo } from './iapproval-rule-repo';
export type { IApprovalRecordRepo } from './iapproval-record-repo';
export type { INotificationLogRepo } from './inotification-log-repo';
export type { IOcrService } from './iocr-service';
export type { INotificationService } from './inotification-service';
export type { IFileStorage } from './ifile-storage';
```

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter @sse/core build`
Expected: 编译成功

- [ ] **Step 3: 提交**

```bash
git add packages/core/
git commit -m "feat(core): define all port interfaces (repository, service, storage)"
```

---

## Task 3: core/ — 领域服务

**Files:**
- Create: `sse/packages/core/src/services/approval-engine.ts`
- Create: `sse/packages/core/src/services/report-service.ts`
- Create: `sse/packages/core/src/services/statistics-service.ts`
- Create: `sse/packages/core/src/services/index.ts`
- Create: `sse/packages/core/src/services/__tests__/approval-engine.test.ts`
- Create: `sse/packages/core/src/index.ts`

- [ ] **Step 1: 实现审批引擎**

`services/approval-engine.ts`:
```typescript
import type { ApprovalRule } from '@sse/shared';
import type { IApprovalRuleRepo, IApprovalRecordRepo } from '../ports';

export class ApprovalEngine {
  constructor(
    private ruleRepo: IApprovalRuleRepo,
    private recordRepo: IApprovalRecordRepo,
  ) {}

  async matchRule(totalAmount: number, categoryIds: string[]): Promise<ApprovalRule | null> {
    const rules = await this.ruleRepo.findActive();

    const matched = rules
      .filter(rule => {
        const inRange = totalAmount >= rule.minAmount && totalAmount < rule.maxAmount;
        if (!inRange) return false;
        if (rule.categoryIds && rule.categoryIds.length > 0) {
          return categoryIds.some(cid => rule.categoryIds!.includes(cid));
        }
        return true;
      })
      .sort((a, b) => a.priority - b.priority);

    return matched[0] || null;
  }

  async startApproval(reportId: string, rule: ApprovalRule): Promise<void> {
    const record = {
      reportId,
      step: rule.approvalChain[0].step,
      approverId: '', // 由调用方根据 role 查找实际审批人后填充
      stepStartedAt: new Date(),
      result: 'pending' as const,
    };
    await this.recordRepo.create(record);
  }

  async approveStep(reportId: string, step: number, approverId: string, result: string, comment?: string): Promise<boolean> {
    await this.recordRepo.updateResult(reportId, result, comment);

    if (result === 'approved') {
      return false; // 调用方判断是否为最后一步
    }
    return true;
  }
}
```

- [ ] **Step 2: 编写审批引擎测试**

`services/__tests__/approval-engine.test.ts`:
```typescript
import { ApprovalEngine } from '../approval-engine';
import type { ApprovalRule } from '@sse/shared';

describe('ApprovalEngine', () => {
  const mockRules: ApprovalRule[] = [
    {
      id: 'r1', name: '小额日常', minAmount: 0, maxAmount: 500,
      categoryIds: ['c_office', 'c_comm', 'c_other'],
      approvalChain: [{ step: 1, role: 'dept_approver', label: '部门审批人' }],
      priority: 10, isActive: true,
    },
    {
      id: 'r2', name: '常规报销', minAmount: 500, maxAmount: 3000,
      categoryIds: [],
      approvalChain: [
        { step: 1, role: 'dept_approver', label: '直属上级' },
        { step: 2, role: 'finance', label: '财务复核' },
      ],
      priority: 5, isActive: true,
    },
    {
      id: 'r3', name: '高额差旅', minAmount: 3000, maxAmount: 999999,
      categoryIds: ['c_transport', 'c_hotel', 'c_entertain'],
      approvalChain: [
        { step: 1, role: 'dept_approver', label: '直属上级' },
        { step: 2, role: 'dept_approver', label: '部门负责人' },
        { step: 3, role: 'finance', label: '财务复核' },
      ],
      priority: 1, isActive: true,
    },
  ];

  const mockRuleRepo = { findActive: async () => mockRules, findById: async () => null, findAll: async () => [], create: async () => ({} as any), update: async () => {}, delete: async () => {} };
  const mockRecordRepo = { findByReportId: async () => [], findPendingOverdue: async () => [], create: async (r: any) => r, updateResult: async () => {}, markReminderSent: async () => {}, markEscalated: async () => {} };

  const engine = new ApprovalEngine(mockRuleRepo, mockRecordRepo);

  it('should match 小额日常 rule for 低金额 + 匹配类别', async () => {
    const rule = await engine.matchRule(300, ['c_office']);
    expect(rule?.id).toBe('r1');
  });

  it('should match 常规报销 rule for 中等金额', async () => {
    const rule = await engine.matchRule(1000, ['c_training']);
    expect(rule?.id).toBe('r2');
  });

  it('should match 高额差旅 rule for 高金额 + 匹配类别', async () => {
    const rule = await engine.matchRule(5000, ['c_transport']);
    expect(rule?.id).toBe('r3');
  });

  it('should match 常规报销 for 高金额但非差旅类别', async () => {
    const rule = await engine.matchRule(5000, ['c_office']);
    expect(rule?.id).toBe('r2');
  });

  it('should return null when no rule matches', async () => {
    const rule = await engine.matchRule(-1, []);
    expect(rule).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter @sse/core test`
Expected: 5/5 PASS

- [ ] **Step 4: 实现 ReportService**

`services/report-service.ts`:
```typescript
import type { CreateReportDto, ExpenseReport, ExpenseItem, ApprovalRecord } from '@sse/shared';
import { ReportStatus } from '@sse/shared';
import type { IExpenseRepo, IApprovalRuleRepo, IApprovalRecordRepo } from '../ports';
import { ApprovalEngine } from './approval-engine';
import { generateSerialNo } from '../utils';

export class ReportService {
  private engine: ApprovalEngine;

  constructor(
    private expenseRepo: IExpenseRepo,
    ruleRepo: IApprovalRuleRepo,
    recordRepo: IApprovalRecordRepo,
  ) {
    this.engine = new ApprovalEngine(ruleRepo, recordRepo);
  }

  async submitReport(dto: CreateReportDto, userId: string): Promise<ExpenseReport> {
    const serialNo = generateSerialNo();
    const report = await this.expenseRepo.create(dto, userId, serialNo);

    const totalAmount = dto.items.reduce((sum, item) => sum + item.amount, 0);
    const categoryIds = [...new Set(dto.items.map(i => i.categoryId))];

    const rule = await this.engine.matchRule(totalAmount, categoryIds);
    if (!rule) {
      throw new Error('没有匹配的审批规则');
    }

    await this.expenseRepo.updateStatus(report.id, ReportStatus.PENDING, 1);
    return report;
  }
}
```

- [ ] **Step 5: 创建工具函数**

Create: `sse/packages/core/src/utils.ts`:
```typescript
export function generateSerialNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `RE-${y}${m}${d}-${rand}`;
}
```

`core/src/index.ts`:
```typescript
export * from './ports';
export * from './services';
export { generateSerialNo } from './utils';
```

- [ ] **Step 6: 构建和测试**

Run: `pnpm --filter @sse/core build && pnpm --filter @sse/core test`

- [ ] **Step 7: 提交**

```bash
git add packages/core/
git commit -m "feat(core): implement ApprovalEngine with rule matching + tests"
```

---

## Task 4: db/ — 数据库迁移和仓储实现

**Files:**
- Create: `sse/packages/db/src/migrate.ts`
- Create: `sse/packages/db/src/migrations/001_initial.sql`
- Create: `sse/packages/db/src/connection.ts`
- Create: `sse/packages/db/src/repositories/pg-expense-repo.ts`
- Create: `sse/packages/db/src/repositories/pg-user-repo.ts`
- Create: `sse/packages/db/src/repositories/pg-invoice-repo.ts`
- Create: `sse/packages/db/src/repositories/pg-approval-rule-repo.ts`
- Create: `sse/packages/db/src/repositories/pg-approval-record-repo.ts`
- Create: `sse/packages/db/src/repositories/pg-notification-log-repo.ts`
- Create: `sse/packages/db/src/repositories/index.ts`
- Create: `sse/packages/db/tsconfig.json`

- [ ] **Step 1: 创建数据库连接层**

`connection.ts`:
```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'sse',
  user: process.env.DB_USER || 'sse',
  password: process.env.DB_PASSWORD || 'sse_dev',
  max: 20,
  idleTimeoutMillis: 30000,
});

export { pool };
```

- [ ] **Step 2: 编写初始迁移 SQL**

`migrations/001_initial.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(100),
  department VARCHAR(50) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('employee','dept_approver','finance','admin')),
  parent_id UUID REFERENCES users(id),
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  password_hash VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL,
  parent_id UUID REFERENCES expense_categories(id),
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO expense_categories (id, name, sort_order) VALUES
  ('c0000000-0000-0000-0000-000000000001', '交通', 1),
  ('c0000000-0000-0000-0000-000000000002', '住宿', 2),
  ('c0000000-0000-0000-0000-000000000003', '餐饮', 3),
  ('c0000000-0000-0000-0000-000000000004', '招待', 4),
  ('c0000000-0000-0000-0000-000000000005', '办公用品', 5),
  ('c0000000-0000-0000-0000-000000000006', '通讯', 6),
  ('c0000000-0000-0000-0000-000000000007', '培训', 7),
  ('c0000000-0000-0000-0000-000000000008', '其他', 8)
ON CONFLICT DO NOTHING;

CREATE TABLE expense_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  serial_no VARCHAR(30) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','paid')),
  current_step INT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_reports_user_status ON expense_reports(user_id, status);
CREATE INDEX idx_expense_reports_status_step ON expense_reports(status, current_step);
CREATE INDEX idx_expense_reports_submitted ON expense_reports(submitted_at);

CREATE TABLE expense_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES expense_categories(id),
  amount DECIMAL(10,2) NOT NULL,
  expense_date DATE NOT NULL,
  description VARCHAR(500)
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES expense_items(id) ON DELETE CASCADE,
  file_name VARCHAR(200) NOT NULL,
  file_format VARCHAR(5) NOT NULL CHECK (file_format IN ('pdf','ofd')),
  file_size INT NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  storage_bucket VARCHAR(100) NOT NULL DEFAULT 'invoices',
  checksum VARCHAR(64) NOT NULL,
  ocr_result JSONB,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approval_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  min_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  max_amount DECIMAL(12,2) NOT NULL DEFAULT 999999,
  category_ids UUID[],
  approval_chain JSONB NOT NULL,
  priority INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE approval_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  step INT NOT NULL,
  approver_id UUID NOT NULL REFERENCES users(id),
  step_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (result IN ('approved','rejected','pending')),
  comment VARCHAR(500),
  approved_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ
);

CREATE INDEX idx_approval_records_report ON approval_records(report_id, step);
CREATE INDEX idx_approval_records_approver ON approval_records(approver_id, result);
CREATE INDEX idx_approval_records_pending_scan ON approval_records(result, step_started_at);

CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES expense_reports(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id),
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('sms','email')),
  trigger_type VARCHAR(30) NOT NULL CHECK (trigger_type IN ('approval_reminder','escalation','rejected','paid')),
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('sent','failed','pending')),
  sent_at TIMESTAMPTZ,
  error_message VARCHAR(500)
);

CREATE INDEX idx_notification_logs_report ON notification_logs(report_id);
CREATE INDEX idx_notification_logs_recipient ON notification_logs(recipient_id, sent_at);

-- 种子数据：默认管理员
INSERT INTO users (id, name, phone, department, role, password_hash) VALUES
  ('a0000000-0000-0000-0000-000000000001', '管理员', '13800000001', '管理部', 'admin', '$2b$10$placeholder')
ON CONFLICT DO NOTHING;

-- 默认审批规则
INSERT INTO approval_rules (id, name, min_amount, max_amount, approval_chain, priority, is_active) VALUES
  ('r0000000-0000-0000-0000-000000000001', '标准审批', 0, 999999,
   '[{"step":1,"role":"dept_approver","label":"部门审批人","reminder_after_hours":48,"escalate_after_hours":96,"escalate_to":"parent_of_approver"}]'::jsonb,
   10, true)
ON CONFLICT DO NOTHING;
```

- [ ] **Step 3: 创建迁移执行器**

`migrate.ts`:
```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './connection';

async function migrate() {
  const client = await pool.connect();
  try {
    const sql = readFileSync(join(__dirname, 'migrations', '001_initial.sql'), 'utf-8');
    await client.query(sql);
    console.log('Migration 001 applied successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: 运行迁移**

Run: `pnpm --filter @sse/db build && pnpm --filter @sse/db migrate`
Expected: "Migration 001 applied successfully"

- [ ] **Step 5: 实现 PgExpenseRepo**

`repositories/pg-expense-repo.ts` (完整实现):
```typescript
import { pool } from '../connection';
import type { ExpenseReport, ExpenseItem } from '@sse/shared';
import type { IExpenseRepo, ExpenseQuery } from '@sse/core';

export class PgExpenseRepo implements IExpenseRepo {
  async findById(id: string): Promise<ExpenseReport | null> {
    const { rows } = await pool.query('SELECT * FROM expense_reports WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    return this.mapReport(rows[0]);
  }

  async findMany(query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (query.dateFrom) { conditions.push(`submitted_at >= $${paramIdx++}`); params.push(query.dateFrom); }
    if (query.dateTo) { conditions.push(`submitted_at <= $${paramIdx++}`); params.push(query.dateTo); }
    if (query.applicantId) { conditions.push(`user_id = $${paramIdx++}`); params.push(query.applicantId); }
    if (query.status) { conditions.push(`status = $${paramIdx++}`); params.push(query.status); }
    if (query.keyword) { conditions.push(`title ILIKE $${paramIdx++}`); params.push(`%${query.keyword}%`); }
    if (query.amountMin) { conditions.push(`total_amount >= $${paramIdx++}`); params.push(query.amountMin); }
    if (query.amountMax) { conditions.push(`total_amount <= $${paramIdx++}`); params.push(query.amountMax); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const countResult = await pool.query(`SELECT COUNT(*) FROM expense_reports ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const { rows } = await pool.query(
      `SELECT * FROM expense_reports ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, pageSize, offset]
    );

    return { results: rows.map(this.mapReport), total };
  }

  async findManyByApprover(approverId: string, page: number, pageSize: number): Promise<{ results: ExpenseReport[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT er.id) FROM expense_reports er
       JOIN approval_records ar ON er.id = ar.report_id
       WHERE ar.approver_id = $1 AND ar.result = 'pending' AND er.status = 'pending'`,
      [approverId]
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const { rows } = await pool.query(
      `SELECT DISTINCT er.* FROM expense_reports er
       JOIN approval_records ar ON er.id = ar.report_id
       WHERE ar.approver_id = $1 AND ar.result = 'pending' AND er.status = 'pending'
       ORDER BY er.created_at DESC LIMIT $2 OFFSET $3`,
      [approverId, pageSize, offset]
    );

    return { results: rows.map(this.mapReport), total };
  }

  async findManyByUser(userId: string, query: ExpenseQuery): Promise<{ results: ExpenseReport[]; total: number }> {
    const q = { ...query, applicantId: userId };
    return this.findMany(q);
  }

  async create(dto: any, userId: string, serialNo: string): Promise<ExpenseReport> {
    const totalAmount = dto.items.reduce((sum: number, item: any) => sum + item.amount, 0);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO expense_reports (serial_no, user_id, title, total_amount) VALUES ($1, $2, $3, $4) RETURNING *`,
        [serialNo, userId, dto.title, totalAmount]
      );
      const report = rows[0];

      for (const item of dto.items) {
        await client.query(
          `INSERT INTO expense_items (report_id, category_id, amount, expense_date, description) VALUES ($1, $2, $3, $4, $5)`,
          [report.id, item.categoryId, item.amount, item.expenseDate, item.description]
        );
      }

      await client.query('COMMIT');
      return this.mapReport(report);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async updateStatus(id: string, status: string, currentStep?: number): Promise<void> {
    await pool.query(
      `UPDATE expense_reports SET status = $1, current_step = COALESCE($2, current_step),
       submitted_at = CASE WHEN $1 = 'pending' AND submitted_at IS NULL THEN NOW() ELSE submitted_at END,
       completed_at = CASE WHEN $1 IN ('approved','rejected') THEN NOW() ELSE completed_at END,
       updated_at = NOW() WHERE id = $3`,
      [status, currentStep || 0, id]
    );
  }

  async getStatistics(dateFrom?: string, dateTo?: string, department?: string): Promise<any> {
    const params: any[] = [];
    const conditions: string[] = ['er.status != $1'];
    params.push('draft');
    let paramIdx = 2;

    if (dateFrom) { conditions.push(`er.submitted_at >= $${paramIdx++}`); params.push(dateFrom); }
    if (dateTo) { conditions.push(`er.submitted_at <= $${paramIdx++}`); params.push(dateTo); }
    if (department) { conditions.push(`u.department = $${paramIdx++}`); params.push(department); }

    const where = conditions.join(' AND ');

    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(er.total_amount), 0) as total_amount,
              COUNT(er.id) as report_count,
              ROUND(AVG(er.total_amount), 2) as average_per_report
       FROM expense_reports er
       JOIN users u ON er.user_id = u.id
       WHERE ${where}`,
      params
    );
    return rows[0];
  }

  async getUserSummary(userId: string, dateFrom?: string, dateTo?: string): Promise<any> {
    return { userId, reportCount: 0, totalAmount: 0, byCategory: [] };
  }

  private mapReport(row: any): ExpenseReport {
    return {
      id: row.id, serialNo: row.serial_no, userId: row.user_id,
      title: row.title, totalAmount: Number(row.total_amount),
      status: row.status, currentStep: row.current_step,
      submittedAt: row.submitted_at, completedAt: row.completed_at,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}
```

其他仓储实现同理（PgUserRepo, PgInvoiceRepo, PgApprovalRuleRepo, PgApprovalRecordRepo, PgNotificationLogRepo）。

- [ ] **Step 6: 提交**

```bash
git add packages/db/
git commit -m "feat(db): add migration, connection pool, and repository implementations"
```

---

## Task 5: auth/ — 认证授权

**Files:**
- Create: `sse/packages/auth/src/jwt.ts`
- Create: `sse/packages/auth/src/rbac.ts`
- Create: `sse/packages/auth/src/middleware.ts`
- Create: `sse/packages/auth/src/index.ts`
- Create: `sse/packages/auth/tsconfig.json`
- Create: `sse/packages/auth/src/__tests__/rbac.test.ts`

- [ ] **Step 1: 实现 JWT 服务**

`jwt.ts`:
```typescript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '2h';
const REFRESH_EXPIRES_IN = '7d';
const MCP_KEY_PREFIX = 'mcp_';

export function signToken(payload: { userId: string; role: string; department: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

export function verifyToken(token: string): { userId: string; role: string; department: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.type === 'refresh') return null;
    return { userId: payload.userId, role: payload.role, department: payload.department };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.type !== 'refresh') return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export function generateMcpApiKey(): string {
  const crypto = require('crypto');
  return MCP_KEY_PREFIX + crypto.randomBytes(24).toString('hex');
}
```

- [ ] **Step 2: 实现 RBAC 权限判断**

`rbac.ts`:
```typescript
export type Role = 'employee' | 'dept_approver' | 'finance' | 'admin';

interface Permission {
  canSubmit: boolean;
  canApprove: boolean;
  canFinalize: boolean;
  canExport: boolean;
  canManageUsers: boolean;
  canManageRules: boolean;
}

const ROLE_PERMISSIONS: Record<Role, Permission> = {
  employee:       { canSubmit: true, canApprove: false, canFinalize: false, canExport: false, canManageUsers: false, canManageRules: false },
  dept_approver:  { canSubmit: true, canApprove: true,  canFinalize: false, canExport: false, canManageUsers: false, canManageRules: false },
  finance:        { canSubmit: true, canApprove: false, canFinalize: true,  canExport: true,  canManageUsers: false, canManageRules: false },
  admin:          { canSubmit: true, canApprove: false, canFinalize: true,  canExport: true,  canManageUsers: true,  canManageRules: true },
};

export function getPermissions(role: Role): Permission {
  return ROLE_PERMISSIONS[role];
}

export function canViewReport(viewerRole: Role, viewerDept: string, ownerDept: string, ownerId: string, viewerId: string): boolean {
  if (viewerRole === 'admin' || viewerRole === 'finance') return true;
  if (viewerRole === 'dept_approver' && viewerDept === ownerDept) return true;
  if (viewerId === ownerId) return true;
  return false;
}
```

- [ ] **Step 3: 编写 RBAC 测试**

`__tests__/rbac.test.ts`:
```typescript
import { getPermissions, canViewReport } from '../rbac';

describe('RBAC', () => {
  it('员工可以提交但不能审批', () => {
    const p = getPermissions('employee');
    expect(p.canSubmit).toBe(true);
    expect(p.canApprove).toBe(false);
  });

  it('部门审批人可以看到本部门报销', () => {
    expect(canViewReport('dept_approver', 'tech', 'tech', 'u1', 'u2')).toBe(true);
  });

  it('部门审批人不能看到其他部门报销', () => {
    expect(canViewReport('dept_approver', 'tech', 'sales', 'u1', 'u2')).toBe(false);
  });

  it('财务可以看到所有', () => {
    expect(canViewReport('finance', 'finance', 'tech', 'u1', 'u2')).toBe(true);
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @sse/auth test`
Expected: 4/4 PASS

- [ ] **Step 5: 提交**

```bash
git add packages/auth/
git commit -m "feat(auth): implement JWT service and RBAC permission system"
```

---

## Task 6: api/ — REST API 层

**Files:**
- Create: `sse/packages/api/src/index.ts` (Express 服务启动)
- Create: `sse/packages/api/src/routes/auth.ts`
- Create: `sse/packages/api/src/routes/expenses.ts`
- Create: `sse/packages/api/src/routes/approvals.ts`
- Create: `sse/packages/api/src/routes/statistics.ts`
- Create: `sse/packages/api/src/routes/admin.ts`
- Create: `sse/packages/api/src/middleware/auth.ts`
- Create: `sse/packages/api/src/middleware/error.ts`
- Create: `sse/packages/api/src/middleware/upload.ts`
- Create: `sse/packages/api/tsconfig.json`

（完整实现顺序：认证路由 → 中间件 → 报销 CRUD → 审批路由 → 统计导出 → 管理路由 → 文件上传）

- [ ] **Step 1: 提交每个子模块后执行构建验证**

Run: `pnpm --filter @sse/api build`

---

## Task 7: mcp/ — MCP Server

**Files:**
- Create: `sse/packages/mcp/src/server.ts`
- Create: `sse/packages/mcp/src/tools/search-expenses.ts`
- Create: `sse/packages/mcp/src/tools/get-expense-detail.ts`
- Create: `sse/packages/mcp/src/tools/get-approval-status.ts`
- Create: `sse/packages/mcp/src/tools/get-statistics.ts`
- Create: `sse/packages/mcp/src/tools/get-user-summary.ts`
- Create: `sse/packages/mcp/src/tools/list-pending-approvals.ts`
- Create: `sse/packages/mcp/src/tools/index.ts`
- Create: `sse/packages/mcp/tsconfig.json`

- [ ] **Step 1: 实现 MCP Server 骨架**

使用 `@modelcontextprotocol/sdk`，注册 6 个工具，每个工具调用 core service，处理分页和错误格式。

- [ ] **Step 2: 提交**

```bash
git add packages/mcp/
git commit -m "feat(mcp): implement MCP server with 6 query tools"
```

---

## Task 8: ocr/ — 发票识别

**Files:**
- Create: `sse/packages/ocr/src/parser.ts`
- Create: `sse/packages/ocr/src/pdf.ts`
- Create: `sse/packages/ocr/src/ofd.ts`
- Create: `sse/packages/ocr/src/providers/paddle-ocr.ts`
- Create: `sse/packages/ocr/tsconfig.json`

- [ ] **Step 1: 实现 OFD XML 解析和 PDF OCR 调用**

- [ ] **Step 2: 提交**

---

## Task 9: notifications/ — 通知推送

**Files:**
- Create: `sse/packages/notifications/src/channels/sms.ts`
- Create: `sse/packages/notifications/src/channels/email.ts`
- Create: `sse/packages/notifications/src/scheduler.ts`
- Create: `sse/packages/notifications/tsconfig.json`

- [ ] **Step 1: 实现调度器，扫描超时审批并触发提醒/升级**

- [ ] **Step 2: 提交**

---

## Task 10: web/ — 前端 SPA

**Files:**
- Create: `sse/packages/web/` (Vue 3 + Element Plus 脚手架)
- 10 个页面组件

**前端设计将在后续使用 frontend-design 技能专项完成。**

---

## 依赖顺序图

```
Task 0 (脚手架)
  └─> Task 1 (shared/) ──> Task 2 (core/ports)
                                └─> Task 3 (core/services)
                                       ├─> Task 4 (db/)
                                       ├─> Task 5 (auth/)
                                       │     └─> Task 6 (api/)
                                       ├─> Task 7 (mcp/)
                                       ├─> Task 8 (ocr/)
                                       └─> Task 9 (notifications/)

Task 10 (web/) 可独立并行开发（仅依赖 Task 1 shared/ 类型）
```

---

> 计划位置：`E:\app\opencode\sse\docs\superpowers\plans\2026-07-06-sse-implementation.md`

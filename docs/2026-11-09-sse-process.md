# SSE 开发过程记录（2026-11-09）

> 本次会话覆盖：MinerU Token 来源解析、附件下载代理化、打款回单重新识别语义、银行回单 OCR 解析、
> 扫描件 OCR 前渲染裁白边、上传内容校验。
> 当前 `master` 已推送到 `9817cee`。

---

## 一、本次完成内容

### 1. MinerU Token 来源解析（`31798fa`）

**问题**：测试机上 OCR 持续报 `AUTH：MinerU 认证失败：Token 无效或已过期`，而运维确认
`.env` 里的 `MINERU_TOKEN` 正确有效。

**根因**：`packages/ai/src/config/ai-config.ts` 的 `normalizeAiConfig()` 用
`typeof ocr.mineruToken === 'string'` 判定"是否已保存"。**空串也是 string**，
因此 `ai-config.json` 一旦生成（点一次"保存"就会生成），`.env` 的 `MINERU_TOKEN`
就永远不会被读取 —— 已保存的值（哪怕是空的或过期的）绝对优先。

实测判定表（`normalizeAiConfig`）：

| `ai-config.json` 状态 | 实际生效的 token |
|---|---|
| 文件不存在 | `.env` 的值 |
| `mineruToken` key 缺失 / `null` | `.env` 的值 |
| `mineruToken: ""`（空串） | 空串 → 报"未配置" |
| `mineruToken: "旧值"` | 旧值，`.env` 被丢弃 |

**实现**：
- 解析规则改为「非空已保存值优先 → 空/缺失回落 `.env` → 显式清除则不回落」，
  用独立标记 `mineruTokenCleared` 保住 `clearMineruToken` 的"显式清除"语义。
- 新增 `mineruTokenSource: saved | env | none`，通过 `GET /admin/ai-config` 暴露，
  管理后台同时显示"当前生效来源"，并提供「↩ 环境变量」「✕ 清除」两个入口。
- 新增 `toPersistedAiConfig()`：来源是 `env` 时不把密钥固化进 `ai-config.json`，
  改 `.env` 后重启仍然生效。

**验证**：15 个新用例（RED→GREEN）。

### 2. 附件下载代理化 + 重新识别语义（`afe6f27`）

**问题**：已付款报销单详情页的打款回单下载链接是 `http://localhost:9002/...`，
远程访问必然失败。发票下载有同样的问题。

**根因**：`packages/api/src/storage/minio-storage.ts` 用 `MINIO_ENDPOINT`（默认 `localhost`）
构造唯一的 MinIO client，预签名 URL 把服务器自身地址写进了签名（`X-Amz-SignedHeaders=host`），
前端无法改写 host。

**实现**：
- 两个下载路由改为 **API 代理**（服务端取字节直出），`attachment.ts` 负责
  Content-Type 判定与 RFC 5987 中文文件名编码；删除 `IFileStorage.getSignedUrl`
  以免再被误用。
- 前端新增 `utils/download.ts`（blob 下载 + blob 错误体解析），4 处下载入口统一改造。
- 抽出 `shouldReOcr()`（core 包）统一发票与回单的"缓存是否过期"判定；
  原先回单侧只要存在缓存 OCR 结果就永不重识别，"重新识别"按钮形同虚设。
- 两个面板文案统一为「🔍 重新核对」(force=false) / 「重新识别」(force=true)，
  同一个词不再有两种含义；回单面板新增"识别结果"一行。
- OCR 解析器补银行回单标签（`付款金额`/`交易日期`/`回单编号` 等），
  回单金额只在发票金额没解析出来时才生效，不影响增值税发票解析。

**验证**：22 个新用例。

### 3. 扫描件 OCR 前渲染裁白边（`67227f1`）

**问题**：测试机上一张招商银行出账回单，OCR 只抽出边框外的
`经办： 复核： 授权： 回单编号：…` 一行，金额和日期完全没抽到。

**根因（6 组对照实验，真实 MinerU 调用）**：

| # | 输入 | 结果 |
|---|---|---|
| A | 原 PDF | ❌ 只有框外一行 |
| B | 剥离 32 字节前缀的同一 PDF | ❌ 同上 |
| C | 回单主体裁剪图（原分辨率） | ✅ 全量 |
| D | 整页 A4 PNG @150dpi | ❌ 同上 |
| E | **主体裁剪 @150dpi（同样字号、无白边）** | ✅ 全量 |
| F | 整页 A4 PNG @216dpi（白边不变、分辨率翻倍） | ❌ 同上 |

结论：与 PDF 格式无关（D 是 PNG）、与文件头 32 字节前缀无关（A≈B）、
与分辨率无关（E 同分辨率成功、F 分辨率翻倍仍失败）—— **只与页面留白有关**。
MinerU 的版面分析会把带边框的回单主体判成图片块整体跳过，只 OCR 框外文字。
同一张图交给仓库自带的本地 VLM 可 100% 读全，证明文档本身没有问题。

**实现**：新增 `packages/ai/src/services/document-image.ts`
- PDF 渲染（pdfjs-dist + @napi-rs/canvas，200 DPI）后按近白阈值裁掉白边
- `hasPdfTextLayer()` 区分电子发票与扫描件：**电子发票保持 PDF 上传**，
  扫描件才渲染裁剪后以图片上传（不浪费渲染，也不改差原本好用的路径）
- 视觉模型引擎的 PDF 同样先转图片（原先把 PDF 字节当 `image/jpeg` 发给模型，
  vLLM 直接返回 `Failed to load image`）

**顺带修掉的缺陷**：
- 金额千分位被静默截断：MinerU 输出 `CNY19, 999.00`，原正则只吃到 `"19,"` → **金额变成 19**
- 视觉模型返回 snake_case 字段被原样展开进 `OcrResult`（camelCase）→ **所有字段被丢弃**

**验证**：端到端复测（真实回单）：`amount` 由 `19` 变为 **`19999`**，
日期、编号、付款人、收款人、业务编号全部抽出。

### 4. 上传内容校验（`9817cee`）

发票 / 打款回单 / 头像上传**只校验扩展名**，改名后的任意文件都能入库，
再被送进 OCR 引擎。新增 `validateUploadSignature()` 做魔数校验，
对齐设计文档 §7.3「MIME 嗅探，不依赖扩展名」。

---

## 二、验证结果

```
pnpm build  → 11 个包全部 Done
pnpm test   → core 41 · ai 100 · auth 5 · db 13 · notifications 29 · ontology 8 · api 28
              合计 224 passed / 0 failed（本次会话之前 165）
```

所有修复均按 TDD 实施：先写失败测试 → 实现 → 转绿。

---

## 三、部署与迁移

```bash
git pull
pnpm install        # 新增 pdfjs-dist 与 @napi-rs/canvas，不可跳过
pnpm build
# 重启 API
```

- 无数据库迁移，无新增环境变量。
- `@napi-rs/canvas` 是预编译二进制，pnpm 会自动安装对应平台产物，无需原生编译。

---

## 四、测试机当前状态

- 代码已推送到 `9817cee`。
- **历史回单的 OCR 结果不会自动重算**：已有 receipt 仍是旧结果，
  需在报销详情页点「重新识别」才会用新管线重跑（会消耗 MinerU 额度）。

---

## 五、下一会话待办

### P0：密码安全（仍未修）

- `packages/api/src/routes/auth.ts` 登录只校验手机号存在与状态，**完全不校验密码**。
- `packages/api/src/routes/admin.ts` 创建用户时忽略传入的 `password`。
- `packages/api/src/routes/auth.ts` 修改密码明文写入 `password_hash`（无 bcrypt）。

### P1：历史数据回填

- 批量刷新历史打款回单的 OCR 结果（新管线 + 新的千分位解析）。
- 可考虑写入脚本，避免逐单手动点「重新识别」。

### P2：其余

- 附件路径里 bucket 重复（`/invoices/invoices/...`），仅影响排查体验，
  改 key 格式需动历史数据，暂不处理。
- 扫描件 PDF 规范化（开头 32 字节二进制前缀 + xref 偏移错位 32 字节）：
  当前渲染器能自愈，不影响功能，但不符合 PDF 规范。

---

## 六、本次提交记录

| Commit | 说明 |
|---|---|
| `31798fa` | fix(ai): resolve MinerU token from saved config or environment |
| `afe6f27` | fix(payments): proxy attachment downloads and re-verify receipts |
| `67227f1` | fix(ai): render and trim scan-like documents before OCR |
| `9817cee` | fix(api): validate uploaded file content against its extension |

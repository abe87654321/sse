# 系统管理引擎设置可用性优化 — 设计

> 日期：2026-11-02
> 分支：`feat/admin-engine-usability`
> 状态：设计评审通过，待实施

---

## 1. 背景

系统管理页面的「智能填单引擎」和「发票OCR引擎」配置门槛偏高：

- 智能填单要求填写完整的 `/v1/chat/completions` 地址，普通管理员通常只知道服务根地址（如 `http://192.168.3.117:11434`）。
- 智能填单没有 API 密钥输入，无法对接需要鉴权的 OpenAI 兼容服务。
- 模型只能从固定下拉框选择，无法查看该地址实际提供了哪些模型，也无法分辨推理、视觉、嵌入、重排等用途。
- 检测按钮只验证已保存配置，不能先用当前输入做连通性验证。
- 发票 OCR 测试只返回一行文字，缺少耗时、失败原因、识别字段、原始文本和历史记录，排查困难。

本次优化把配置流程改为：

**填写服务根地址 → 填写密钥（可选）→ 一键检测 → 从模型列表中选择模型 → 保存**

发票 OCR 侧重点提升测试的可观测性和可复现性。

---

## 2. 目标与非目标

### 2.1 目标

1. 智能填单 API 地址支持服务根地址，同时兼容旧的完整接口地址。
2. 新增 API 密钥配置，密钥只写不读。
3. 「检测」直接使用当前表单输入，完成模型列表读取和一次最小对话。
4. 新增模型选择对话框：搜索、分类筛选、刷新、`+` / `−` 加入或移出模型文本框、手动修正分类。
5. 模型清单、已选模型、手动分类按 API 地址持久化到 `ai-config.json`。
6. 发票 OCR 测试展示耗时、状态、识别字段、原始文本、失败原因与建议，支持上传样例和历史记录。
7. 保持本体引擎、MCP、视觉 OCR 等现有调用方兼容。

### 2.2 非目标

- 不实现模型下载、拉取、删除。
- 不实现模型级参数（temperature、上下文长度等）配置。
- 不把 MinerU / PaddleOCR 改造成统一模型选择器。
- 不使用数据库持久化模型清单或测试历史。
- 不处理多管理员同时编辑配置的冲突。
- 不做模型能力的人工审核流程。

---

## 3. 现状与改动点

| 位置 | 现状 | 改动 |
|---|---|---|
| `packages/web/src/pages/Admin.vue` | 智能填单仅有端点、模型下拉、固定检测；OCR 仅有一行结果 | 接入新字段、模型对话框、测试面板 |
| `packages/api/src/routes/admin.ts` | `/ai-models` 基于已保存配置；`/ai-test` 只支持已保存配置 | 新增检测、模型列表、当前配置测试、OCR 上传测试、历史接口 |
| `packages/api/src/services/ai-engines.ts` | `fillEngine` 只有 endpoint/model/enabled | 增加 apiKey、catalogs、visionApiKey |
| `packages/ai/src/providers/local-provider.ts` | 要求完整 `/chat/completions` 地址 | 支持根地址，内部拼接；透传 apiKey |
| `packages/ontology`、`packages/mcp` | 只传 endpoint/model | 透传 apiKey |
| `.gitignore` | 未忽略测试历史 | 忽略 `ai-test-history.json` |

---

## 4. 地址规范化

### 4.1 保存形式

配置中保存**服务根地址**：去掉尾部 `/` 和 `/chat/completions`；若结果以 `/v1` 结尾，也去掉 `/v1`。

| 用户输入 | 规范化保存 |
|---|---|
| `http://192.168.3.117:11434` | `http://192.168.3.117:11434` |
| `http://192.168.3.117:11434/` | `http://192.168.3.117:11434` |
| `http://192.168.3.117:11434/v1` | `http://192.168.3.117:11434` |
| `http://192.168.3.117:11434/v1/chat/completions` | `http://192.168.3.117:11434` |
| `https://openrouter.ai/api/v1` | `https://openrouter.ai/api` |
| `https://openrouter.ai/api/v1/chat/completions` | `https://openrouter.ai/api` |
| `https://api.deepseek.com` | `https://api.deepseek.com` |

### 4.2 调用地址推导

```text
apiBase  = base.endsWith('/v1') ? base : base + '/v1'
modelsUrl = apiBase + '/models'
chatUrl   = apiBase + '/chat/completions'
```

- 根地址 `http://host:11434` → `http://host:11434/v1/models`、`http://host:11434/v1/chat/completions`
- `https://openrouter.ai/api` → `https://openrouter.ai/api/v1/models`
- 兼容旧配置：`LocalProvider` 若收到的地址已经以 `/chat/completions` 结尾，直接使用；否则按上述规则拼接。

### 4.3 Ollama 回退

若 `modelsUrl` 返回 404，再尝试 `base + '/api/tags'`，把 Ollama 返回的 `models` 转换为统一模型结构。

### 4.4 约束

- 仅允许 `http` / `https`。
- 检测和模型列表请求超时 20 秒。
- 请求使用 `redirect: 'manual'`，不跟随重定向，避免把 `Authorization` 带到其他主机。
- 地址为空或格式非法时，前端直接提示，不发起请求。

---

## 5. 配置结构

`packages/api/src/services/ai-engines.ts` 的 `AiConfig` 扩展为：

```jsonc
{
  "fillEngine": {
    "endpoint": "http://192.168.3.117:11434",
    "apiKey": "",
    "model": "qwen2.5:7b",
    "enabled": true,
    "catalogs": {
      "http://192.168.3.117:11434": {
        "fetchedAt": "2026-11-02T10:00:00.000Z",
        "source": "openai",
        "models": [
          {
            "id": "qwen2.5:7b",
            "name": "qwen2.5:7b",
            "owner": "library",
            "metadata": {},
            "autoTags": ["推理", "工具"],
            "manualTags": [],
            "selected": true
          }
        ]
      }
    }
  },
  "ocrEngine": {
    "provider": "mineru",
    "mineruEndpoint": "https://mineru.net",
    "mineruToken": "",
    "paddleEndpoint": "http://localhost:8899",
    "visionEndpoint": "http://192.168.3.117:11434",
    "visionModel": "glm-ocr",
    "visionApiKey": "",
    "enabled": true
  }
}
```

规则：

- `selected = true` 的模型才会出现在模型文本框中。
- `fillEngine.model` 是当前实际使用的模型，必须属于 `selected` 集合，除非集合为空。
- `catalogs` 以规范化后的 API 地址为键；切换地址时加载对应清单。
- `manualTags` 非空时覆盖 `autoTags`；清空后恢复自动分类。
- `GET /admin/ai-config` 不返回 `apiKey` / `visionApiKey` / `mineruToken` 明文，改为返回 `apiKeySet`、`visionApiKeySet`、`mineruTokenSet`。
- `PUT /admin/ai-config` 中密钥为空字符串表示不修改；显式传入 `clearApiKey: true` / `clearVisionApiKey: true` 才清空。

---

## 6. 智能填单页面交互

```text
智能填单引擎
API 地址   [ http://192.168.3.117:11434              ]
           填写到端口或 /v1 即可，系统自动补全接口路径
API 密钥   [ ••••••••••••••••••••••••••••••••• ][检测]
           密钥可选；留空表示不修改已保存密钥
模型       [ qwen2.5:7b ▼ ] [获取模型列表]   已选 3 个模型
           ✓ 连接成功 · 模型 12 个 · 对话 320ms
[保存] [检验文字识别] [启用]
```

### 6.1 检测

- 检测使用当前输入框中的 API 地址和密钥，不要求先保存。
- 检测分两步，两步都成功才算成功：
  1. 读取模型列表（`/v1/models`，Ollama 回退 `/api/tags`）。
  2. 用当前选中模型发起一次最小对话（`max_tokens: 1`，提示词 `ping`）。
- 若当前没有选中模型，使用模型列表第一个；模型列表为空则返回失败并提示先获取模型列表。
- 结果展示模型数量、两步各自耗时、失败步骤和原因。
- 密钥留空且地址与已保存地址一致时，回退使用已保存密钥；地址不同则不带密钥，避免密钥泄露到新主机。

### 6.2 模型字段

- 模型字段是一个下拉框（即需求中所说的模型文本框），选项来自当前 API 地址下 `selected=true` 的模型。
- 下拉框当前值写入 `fillEngine.model`，即实际调用模型。
- 下拉框旁显示「已选 N 个模型」。
- 「获取模型列表」打开第 7 节对话框。
- 页面加载时若当前地址没有缓存清单，后台自动拉取一次；失败时保留旧选中模型并提示手动刷新。
- 首次升级时若某地址没有清单，当前 `fillEngine.model` 自动视为已选，避免配置看起来丢失。

---

## 7. 模型选择对话框

```text
┌ 选择模型 ─────────────────────────────────────────────┐
│ [搜索模型 ID 或名称            ] [刷新 ⟳]             │
│ [全部 12] [推理 4] [视觉 2] [联网 1] [免费 5]         │
│ [嵌入 3] [重排 1] [工具 6]                            │
│                                                       │
│ qwen2.5:7b          推理 · 工具                 [ − ] │
│ qwen2.5vl:7b        视觉 · 工具                 [ + ] │
│ text-embedding-3    嵌入                        [ + ] │
│                                                       │
│ 已选 3 个模型                     [取消] [确定]        │
└───────────────────────────────────────────────────────┘
```

### 7.1 `+` / `−` 语义

对话框始终列出该 API 地址返回的**全部模型**，不因是否已选而隐藏。

- `+`：该模型在 API 地址中存在，但**尚未加入**模型文本框。
- 点击 `+`：把模型加入模型文本框，按钮立即变成 `−`。
- `−`：该模型**已经加入**模型文本框。
- 点击 `−`：把模型从模型文本框移出，按钮立即变成 `+`。
- 搜索和分类标签只影响对话框中的可见行，不改变已选状态。
- `刷新` 只重新拉取模型列表，不改变已选状态。

### 7.2 刷新与合并

- 刷新使用当前对话框收到的 API 地址和密钥重新请求。
- 按模型 `id` 合并：
  - 仍存在的模型保留 `selected`、`manualTags`、`autoTags`。
  - 新模型默认 `selected=false`。
  - 已选但本次未返回的模型保留在清单中，标记「当前地址未返回」，允许手动移出，避免静默丢失配置。

### 7.3 确认与取消

- 对话框内修改先写入草稿。
- 点「确定」时通过 `PUT /admin/ai-config` 提交 `fillEngine.catalogs[当前地址]` 与可能变化的 `fillEngine.model`，成功后刷新页面模型下拉框。
- 点「取消」丢弃本次修改。
- 若移除了当前使用模型：
  - 仍有其他已选模型：自动选中第一个剩余模型。
  - 没有剩余模型：清空 `fillEngine.model`，页面提示需要重新选择。

### 7.4 手动分类

- 每个模型行提供「编辑标签」入口，弹出 7 类复选：推理、视觉、联网、免费、嵌入、重排、工具。
- 「全部」不是标签，只是聚合页。
- 保存后 `manualTags` 覆盖 `autoTags`；提供「恢复自动」清空 `manualTags`。
- 手动标签随模型清单按地址持久化。

---

## 8. 模型分类规则

分类器放在 `@sse/ai`，输入为 `{ id, name, owner, metadata, source }`，输出标签数组。一个模型可以有多标签。

### 8.1 元数据优先

| 标签 | 判定 |
|---|---|
| 视觉 | OpenRouter `architecture.input_modalities` 含 `image` 或 `video`；Ollama `details.family` 属于视觉模型族 |
| 免费 | OpenRouter `pricing.prompt === 0 && pricing.completion === 0`；或模型 ID 以 `:free` 结尾 |
| 工具 | `supported_parameters` 含 `tools` 或 `tool_choice` |
| 联网 | 模型 ID 含 `:online`，或元数据标记支持 web/search |
| 推理 | `supported_parameters` 含 `reasoning`，或模型 ID 命中推理启发式 |
| 嵌入 | 模型 ID 命中嵌入启发式 |
| 重排 | 模型 ID 命中重排启发式 |

### 8.2 名称启发式兜底

| 标签 | 关键词 |
|---|---|
| 推理 | `r1`、`reason`、`reasoner`、`qwq`、`thinking`、`o1`、`o3`、`o4`、`deepseek-r1`、`phi-4-reasoning` |
| 视觉 | `vl`、`vision`、`llava`、`pixtral`、`moondream`、`minicpm-v`、`gemma3`、`glm-4v`、`internvl`、`cogvlm` |
| 嵌入 | `embed`、`embedding`、`bge`、`e5-`、`gte`、`nomic-embed`、`jina-embed`、`text-embedding` |
| 重排 | `rerank`、`reranker`、`bge-reranker`、`jina-rerank` |
| 联网 | `online`、`web`、`search`、`sonar`、`perplexity` |
| 免费 | `:free` |
| 工具 | 元数据含 `tools` / `tool_choice`，或已知支持工具调用的模型族（gpt-4/o 系列、qwen2.5/3、llama3.1+、mistral、command-r、deepseek-chat、glm-4） |

无任何标签的模型只出现在「全部」。

---

## 9. 后端接口

### 9.1 连通检测

```http
POST /admin/ai-connection-test
Content-Type: application/json

{
  "endpoint": "http://192.168.3.117:11434",
  "apiKey": "optional",
  "model": "qwen2.5:7b"
}
```

响应（HTTP 200，业务结果看 `success`）：

```jsonc
{
  "success": true,
  "message": "连接成功",
  "steps": [
    { "name": "models", "ok": true, "status": 200, "elapsedMs": 42, "modelCount": 12 },
    { "name": "chat", "ok": true, "status": 200, "elapsedMs": 320, "model": "qwen2.5:7b" }
  ]
}
```

失败时对应步骤 `ok=false`，并返回 `error: { code, message, suggestion }`。

### 9.2 模型列表

```http
POST /admin/ai-models
Content-Type: application/json

{ "endpoint": "http://192.168.3.117:11434", "apiKey": "optional" }
```

响应：

```jsonc
{
  "source": "openai",
  "elapsedMs": 42,
  "models": [
    {
      "id": "qwen2.5:7b",
      "name": "qwen2.5:7b",
      "owner": "library",
      "metadata": {},
      "autoTags": ["推理", "工具"]
    }
  ]
}
```

保留 `GET /admin/ai-models` 旧行为：使用已保存配置，供旧前端调用。

### 9.3 当前配置测试

```http
POST /admin/ai-test/fill
{ "endpoint": "...", "apiKey": "...", "model": "..." }
```

使用当前表单值调用文字识别测试，不要求先保存。

```http
POST /admin/ai-test/ocr
Content-Type: multipart/form-data

file: 可选，PDF/OFD/PNG/JPG，≤20MB
provider: mineru | paddle | vision
mineruEndpoint, mineruToken, paddleEndpoint, visionEndpoint, visionModel, visionApiKey
```

- `file` 为空时使用内置样例发票。
- Token/密钥留空且端点与已保存配置一致时，回退使用已保存值。
- 测试不写 MinIO、不创建报销单。

响应：

```jsonc
{
  "success": true,
  "elapsedMs": 1830,
  "provider": "mineru",
  "endpoint": "https://mineru.net",
  "fields": {
    "invoiceNo": "25362000000115126055",
    "amount": 100.0,
    "totalAmount": 100.0,
    "invoiceDate": "2025-11-06",
    "sellerName": "...",
    "buyerName": "...",
    "taxAmount": 0.0
  },
  "rawText": "识别文本，最多 5000 字",
  "error": null
}
```

失败时 `success=false`，`error` 包含 `code`、`message`、`suggestion`。

### 9.4 测试历史

```http
GET /admin/ai-test-history?type=ocr&limit=10
DELETE /admin/ai-test-history
```

- 历史写入项目根目录 `ai-test-history.json`，与 `ai-config.json` 同目录。
- 最多保留最近 50 条。
- 每条包含：时间、类型（fill/ocr/connection）、provider、endpoint、成功与否、耗时、字段摘要、错误分类、原始文本（最多 5000 字）。
- 不记录 API Key、Token、Authorization。
- 文件加入 `.gitignore`；POSIX 环境尽量设置为仅当前用户可读写。

### 9.5 保留旧接口

`POST /admin/ai-test` 保留，内部复用新测试逻辑，默认读取已保存配置，避免破坏现有调用。

---

## 10. OCR 测试可观测性

页面新增测试结果面板：

```text
测试结果   ✓ 成功   耗时 1.83s
引擎 MinerU · 端点 https://mineru.net
发票号 25362000000115126055   金额 ¥100.00
日期 2025-11-06
销方 ...   购方 ...
[展开原始文本]
[使用内置样例] [上传样例发票] [开始测试]
────────────────────────────
历史记录（最近 10 条）
✓ 11-02 10:31 MinerU 1.83s  ¥100.00  [详情]
✗ 11-02 10:20 MinerU 0.4s   AUTH     [详情]
[清空历史]
```

### 10.1 展示内容

- 引擎、端点。
- 总耗时、成功/失败、HTTP 状态。
- 识别字段：发票号、金额、税额、日期、销方、购方。
- 可折叠原始文本，最多显示 5000 字。
- 失败原因与修复建议。

### 10.2 失败分类

| 分类 | 触发条件 | 建议 |
|---|---|---|
| `AUTH` | 401 / 403，或 MinerU `A0202` / `A0211` | 检查 Token 或 API 密钥 |
| `ADDRESS` | DNS 失败、连接拒绝、404 | 检查地址、端口和路径 |
| `TIMEOUT` | 请求超时或 AbortError | 检查服务负载或适当延长超时 |
| `NO_RESULT` | 请求成功但未识别到发票字段 | 确认文件是有效发票，或更换 OCR 引擎 |
| `FORMAT` | 返回内容无法解析 | 检查服务返回格式是否符合预期 |
| `UNKNOWN` | 其他异常 | 查看原始错误信息 |

### 10.3 样例上传

- 支持 PDF、OFD、PNG、JPG，最大 20MB。
- 仅用于本次测试，不持久化到 MinIO。
- 未上传时使用仓库内置样例；内置样例不存在时返回明确错误。
- 测试上传文件只在内存中处理，不写入磁盘或 MinIO。

---

## 11. 安全

1. 所有新接口沿用 admin 鉴权和现有限流。
2. 配置读取接口不返回任何密钥明文，只返回 `*Set` 布尔值。
3. 密钥留空时，仅在请求地址与已保存地址一致时使用已保存密钥。
4. 检测和模型列表不跟随重定向，避免跨主机泄露 `Authorization`。
5. 仅允许 `http` / `https`；本系统允许内网地址，因此不封禁私有 IP。
6. 测试历史不记录密钥；原始文本截断并加入 `.gitignore`。
7. 测试上传文件只在内存中处理，不写入磁盘或 MinIO。

---

## 12. 兼容与迁移

- 旧 `ai-config.json` 中的完整 `/v1/chat/completions` 地址在加载时规范化；下次保存写回根地址。
- `LocalProvider` 同时接受根地址和完整地址，旧的视觉 OCR、本体引擎、MCP 调用不中断。
- `OntologyEngine`、`NlpGenerator`、`EntityExtractor`、MCP `get-engine` 等调用方增加 `apiKey` 透传。
- 视觉 OCR 增加 `visionApiKey`，用于需要鉴权的视觉模型服务。
- 不新增数据库迁移。
- 部署时只需 `pnpm build` 并重启 API；配置文件和测试历史文件无需迁移。

---

## 13. 测试计划

### 13.1 单元测试

- 地址规范化：根地址、`/v1`、完整 `/v1/chat/completions`、带 `/api/v1` 的地址、尾部斜杠、非法协议。
- 调用地址推导：`modelsUrl`、`chatUrl`、Ollama `/api/tags` 回退。
- 模型分类：OpenRouter 元数据、Ollama `details.family`、名称启发式、多标签、无标签。
- 手动标签覆盖与恢复自动。
- `+` / `−` 选择状态、刷新合并、移除当前模型后的回退规则。
- 错误分类：AUTH、ADDRESS、TIMEOUT、NO_RESULT、FORMAT、UNKNOWN。
- 测试历史截断、条数上限、密钥不落盘。

### 13.2 集成/冒烟

- 本地 Ollama 根地址：检测成功、模型列表、加入/移出模型、保存后刷新仍保留。
- 带密钥的 OpenAI 兼容服务：密钥留空回退、地址变更后不回退旧密钥。
- OCR 内置样例测试、上传样例测试、失败样例。
- 历史记录写入、读取、清空。
- 旧配置完整地址加载后仍可正常填单。

### 13.3 构建验证

```text
pnpm --filter @sse/ai build
pnpm --filter @sse/core build
pnpm --filter @sse/api build
pnpm --filter @sse/web build
pnpm --filter @sse/ai test
pnpm --filter @sse/api test
```

---

## 14. 交付物

- 前端：`Admin.vue` 改造、`ModelPickerDialog.vue`、`EngineTestPanel.vue`。
- 后端：地址工具、模型分类器、`admin.ts` 新接口、`ai-engines.ts` 配置扩展、`LocalProvider` 地址支持。
- 配置：`.gitignore` 增加测试历史文件。
- 文档：本设计文档、实施计划、开发过程记录。

# SSE MCP 测试用例集

> 日期：2026-07-29 | 版本：v1.0

---

## 前置条件

### 1. 确认服务运行

```bash
# API 服务：http://localhost:3000
curl -s http://localhost:3000/health | python3 -m json.tool

# MCP 服务：通过 pnpm mcp 启动后保持运行
# 另开终端执行以下测试
```

### 2. 获取 JWT Token（供 MCP 提交类工具使用）

```bash
# 获取管理员 token
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000001","password":"你的管理员密码"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

echo "Admin Token: $ADMIN_TOKEN"
```

### 3. 设置 API Key

```bash
export MCP_API_KEYS="mcp_key_001=$(sudo docker exec -i sse-postgres-1 psql -U sse -d sse -tAc "SELECT id FROM users WHERE role='admin' LIMIT 1"):admin:管理部"
```

---

## 测试方法

MCP Server 通过 **stdio** 协议通信，有两种测试方式：

### 方式 A：直接用 stdin/stdout 发 JSON-RPC（推荐调试用）

```bash
# 1. 创建测试请求文件
cat > /tmp/mcp_list_tools.json << 'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
EOF

# 2. 发送请求
cat /tmp/mcp_list_tools.json | node packages/mcp/dist/index.js
```

### 方式 B：通过 HTTP 端点间接测试

大部分 MCP 工具对应 REST API 端点，可直接用 curl 测试。下面给出每个工具的等效 curl 命令。

---

## 只读工具测试（6 个）

### TC-1: search_expenses — 搜索报销单

```bash
# 查询所有已通过的报销单
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/expenses?status=approved&page=1&page_size=5" \
  | python3 -m json.tool

# 按关键词搜索
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/expenses?keyword=住宿" \
  | python3 -m json.tool

# 预期: 返回分页数据，包含 serial_no, title, total_amount, status
```

### TC-2: get_expense_detail — 获取报销单详情

```bash
# 先查一个报销单 ID
REPORT_ID=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/expenses?page=1&page_size=1" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['id'] if d.get('data') else '')")

echo "Report ID: $REPORT_ID"

# 获取详情
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/expenses/$REPORT_ID" \
  | python3 -m json.tool

# 预期: 包含 report, items[], invoices[], approvalRecords[]
```

### TC-3: get_approval_status — 获取审批状态

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/expenses/$REPORT_ID" \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
for r in d.get('approvalRecords', []):
    print(f\"步骤{r['step']}: {r['result']} (审批人: {r['approverId']})\")"

# 预期: 列出每一步审批的状态
```

### TC-4: get_statistics — 获取统计数据

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/statistics" \
  | python3 -m json.tool

# 月度趋势
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/statistics/monthly" \
  | python3 -m json.tool

# 预期: 返回 summary (total, byStatus, byCategory) 和 monthly 数组
```

### TC-5: get_user_summary — 获取用户报销汇总

```bash
# 获取管理员用户 ID
USER_ID=$(sudo docker exec -i sse-postgres-1 psql -U sse -d sse -tAc \
  "SELECT id FROM users WHERE role='admin' LIMIT 1")

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/expenses?applicant_id=$USER_ID" \
  | python3 -m json.tool

# 预期: 该用户的报销列表
```

### TC-6: list_pending_approvals — 待审批列表

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/approvals/pending" \
  | python3 -m json.tool

# 预期: 待审批记录列表（admin 角色看全部，dept_approver 看本部门）
```

---

## 只读工具 — 本体图谱（3 个）

### TC-7: query_ontology — 查询本体图谱

```bash
# 全图谱
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/ontology/graph" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"节点: {len(d['nodes'])}, 边: {len(d['edges'])}\")"

# 按类型查询
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/ontology/query?type=Person" \
  | python3 -m json.tool

# 预期: 返回图谱数据，Person 节点含 avatarUrl 属性
```

### TC-8: get_entity_network — 获取实体 N 跳网络

```bash
# 先获取一个报告 URI（从 sync 后的图谱中找）
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/ontology/graph" \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
for n in d['nodes']:
    if n['type'] in ('Report','DraftReport','PendingReport','ApprovedReport','PaidReport'):
        print(f\"URI: {n['id']}, Title: {n['properties'].get('title','')}\")
        break
"

# 预期: 返回实体及其 N 跳关系网络
```

### TC-9: query_sparql — SPARQL 跨域查询

```bash
curl -s -X POST http://localhost:3000/ontology/sparql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"query":"SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10"}' \
  | python3 -m json.tool

# 预期: 返回查询结果数组
```

---

## 提交类工具测试（2 个）

### TC-10: submit_expense_from_text — NL 提交报销

```bash
BASE_URL="http://localhost:3000"

# 方式一：调用本体引擎接口
curl -s -X POST "$BASE_URL/ontology/submit-from-text" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"text":"测试差旅费 500 元，住宿费"}' \
  | python3 -m json.tool

# 预期: 返回 { success: true, report_id: "xxx", serial_no: "RE-xxx" }
# 或返回 { success: false, error: {...} } （如金额不足、类别无匹配等）
```

### TC-11: validate_expense — 合规检查

```bash
# 检查金额 + 类别是否能匹配审批规则
curl -s -X POST "$BASE_URL/ontology/submit-from-text" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"text":"测试验证 100 元"}' \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(f\"Success: {d.get('success')}\")
print(f\"Message: {d.get('explanation', d.get('error', {}).get('detail', 'N/A'))}\")"

# 预期: 返回合规验证结果
```

### TC-12: submit_expense_from_invoice — 发票提交（需 OCR）

```bash
# 需要一个 PDF 或图片的 base64，这里用简单的空 base64 测试错误处理
curl -s -X POST "$BASE_URL/ontology/submit-from-text" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"text":"发票金额 1200 元，办公用品"}'

# 直接测试 OCR 接口
curl -s -X POST "$BASE_URL/ai/ocr" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"base64":"", "format":"pdf"}' \
  | python3 -m json.tool

# 预期: OCR 返回识别结果或错误信息
```

---

## 解释类工具测试（2 个）

### TC-13: explain_decision — 解释审批决策

```bash
# 需要有一个已提交的报销单
REPORT_ID=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/expenses?status=pending&page=1&page_size=1" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data'][0]['id'] if d.get('data') else '')")

if [ -n "$REPORT_ID" ]; then
  curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
    "http://localhost:3000/expenses/$REPORT_ID" \
    | python3 -c "
import json,sys
d = json.load(sys.stdin)
rule = d.get('ruleName', '无匹配规则')
records = d.get('approvalRecords', [])
print(f'匹配规则: {rule}')
for r in records:
    print(f'  步骤{r[\"step\"]}: {r[\"result\"]} by {r[\"approverId\"]}')"
fi

# 预期: 显示匹配的审批规则名称和完整的审批链
```

### TC-14: query_expense_status — NL 查询报销状态

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/expenses?keyword=测试" \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
for r in d.get('data', []):
    print(f\"{r['serial_no']}: {r['title']} [{r['status']}] ¥{r['total_amount']}\")"

# 预期: 返回匹配的报销单及状态
```

---

## 一键回归脚本

将以下内容保存为 `test/mcp-regression.sh`，执行 `bash test/mcp-regression.sh`：

```bash
#!/bin/bash
# SSE MCP 一键回归测试
set -e

BASE="http://localhost:3000"
PASS=0
FAIL=0

# 获取 token
TOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000001","password":"admin123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))")

if [ -z "$TOKEN" ]; then
  echo "❌ 登录失败，请检查密码"
  exit 1
fi
echo "✅ 登录成功"

# 健康检查
curl -sf "$BASE/health" > /dev/null && echo "✅ Health" && ((PASS++)) || { echo "❌ Health"; ((FAIL++)); }

# 搜索
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/expenses?page=1&page_size=1" > /dev/null && echo "✅ search_expenses" && ((PASS++)) || { echo "❌ search_expenses"; ((FAIL++)); }

# 统计
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/statistics" > /dev/null && echo "✅ get_statistics" && ((PASS++)) || { echo "❌ get_statistics"; ((FAIL++)); }

# 待审批
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/approvals/pending" > /dev/null && echo "✅ list_pending_approvals" && ((PASS++)) || { echo "❌ list_pending_approvals"; ((FAIL++)); }

# 本体图谱
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/ontology/graph" > /dev/null && echo "✅ query_ontology" && ((PASS++)) || { echo "❌ query_ontology"; ((FAIL++)); }

# SPARQL
curl -sf -X POST "$BASE/ontology/sparql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5"}' > /dev/null && echo "✅ query_sparql" && ((PASS++)) || { echo "❌ query_sparql"; ((FAIL++)); }

# NL 提交
curl -sf -X POST "$BASE/ontology/submit-from-text" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"测试差旅费 500 元"}' > /dev/null && echo "✅ submit_expense_from_text" && ((PASS++)) || { echo "❌ submit_expense_from_text"; ((FAIL++)); }

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
```

---

> 文档位置：`docs/2026-07-29-mcp-test-cases.md`

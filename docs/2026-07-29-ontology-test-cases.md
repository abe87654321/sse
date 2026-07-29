# SSE 本体层升级 — 测试用例

> 日期：2026-07-29

---

## 准备工作：获取管理员 Token

```bash
# 登录获取 token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000000","password":"你的管理员密码"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")

echo "Token: $TOKEN"
```

后续所有 `ADMIN_TOKEN` 替换为 `$TOKEN`。

---

## 场景一：多系统数据融合

### TC1-1：SCIM 创建用户同步到本体

**操作**：
```bash
# 创建 SCIM 用户
curl -s -X POST http://localhost:3000/scim/Users \
  -H "Content-Type: application/json" \
  -d '{
    "userName": "zhangsan",
    "name": {"familyName": "张三"},
    "emails": [{"value": "zhangsan@test.com"}],
    "phoneNumbers": [{"value": "13800000099"}],
    "active": true
  }'

# 查看本体中的 Person 节点
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/ontology/graph \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
for n in d['nodes']:
    if n.get('type') == 'Person':
        print(f'  Person: {n[\"label\"]} (source: {n.get(\"properties\",{}).get(\"source\",\"none\")})')"
```

**预期**：输出包含 `Person: 张三 (source: scim)`。

---

### TC1-2：MDM 更新用户同步到本体

**操作**：
```bash
# 模拟 MDM Webhook 推送用户创建事件
curl -s -X POST http://localhost:3000/webhook/mdm \
  -H "Content-Type: application/json" \
  -d '{
    "event": "user.created",
    "userId": "mdm-test-001",
    "data": {"name": "李四", "phone": "13800000088", "department": "产品部", "role": "employee", "status": "active"}
  }'

# 查看部门节点是否自动创建
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/ontology/graph \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
for n in d['nodes']:
    t = n.get('type','')
    if t == 'Department':
        print(f'  Department: {n[\"label\"]}')
for e in d['edges']:
    print(f'  Edge: {e.get(\"from\",\"\")} --{e.get(\"label\",\"\")}--> {e.get(\"to\",\"\")}')" | head -20
```

**预期**：输出包含 `Department: 产品部`，以及 `Person --belongsTo--> Department` 的边。

---

### TC1-3：打款后本体 Report 类型变为 PaidReport

**前置**：存在一个 `status=approved` 的报销单 ID。

**操作**：
```bash
# 先查一个已通过的报销单
REPORT_ID=$(sudo docker exec -i sse-postgres-1 psql -U sse -d sse -t -c "SELECT id FROM expense_reports WHERE status = 'approved' ORDER BY created_at DESC LIMIT 1" | tr -d '[:space:]')
echo "Report: $REPORT_ID"

# 执行打款
curl -s -X POST http://localhost:3000/expenses/$REPORT_ID/pay \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paymentRef":"BANK-TEST-001"}'

# 同步本体
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/ontology/sync \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'message: {d[\"message\"]}')"

# 按类型查询
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/ontology/query?type=PaidReport"
```

**预期**：`/query?type=PaidReport` 返回包含该报销单的数组。

---

## 场景二：可配置语义推理

### 前提：准备测试数据

```bash
# 1. 确保本体中有数据
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/ontology/sync

# 2. 确认本体中已有 Person belongsTo Department 关系
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/ontology/graph \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'nodes: {len(d[\"nodes\"])}, edges: {len(d[\"edges\"])}')"
```

---

### TC2-1：创建并启用推理规则

**操作**：
```bash
# 创建规则：部门归属传递
curl -s -X POST http://localhost:3000/admin/reasoning-rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "部门归属传递",
    "description": "若人员属于某部门，部门属于某公司，则人员为公司工作",
    "conditions": [
      {"subject": "?p", "predicate": "sse:belongsTo", "object": "?d"},
      {"subject": "?d", "predicate": "sse:partOf", "object": "?c"}
    ],
    "conclusion": {"subject": "?p", "predicate": "sse:worksFor", "object": "?c"},
    "priority": 1,
    "isActive": true
  }'

# 验证规则已创建
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/admin/reasoning-rules \
  | python3 -c "import json,sys; rules=json.load(sys.stdin); print(f'规则数: {len(rules)}'); [print(f'  - {r[\"name\"]} (启用: {r[\"isActive\"]})') for r in rules]"
```

**预期**：输出 `规则数: 1`，包含 `部门归属传递 (启用: True)`。

---

### TC2-2：手动触发推理——部门归属传递

**前置**：本体中已有 `PersonA belongsTo DeptX` 关系。需要先模拟一条 partOf 关系。

**操作**：
```bash
# 手动添加一条部门归属关系（技术部 partOf 总公司）
curl -s -X POST http://localhost:3000/ontology/relation \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "https://sse.local/dept/管理部",
    "predicate": "sse:partOf",
    "to": "https://sse.local/dept/总公司"
  }'

# 触发推理
curl -s -X POST http://localhost:3000/ontology/reason \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'message: {d[\"message\"]}')"

# 查看推理结果——图中应该有 sse:worksFor 边
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/ontology/graph \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
worksFor = [e for e in d['edges'] if 'worksFor' in e.get('label','')]
print(f'worksFor 边数: {len(worksFor)}')
for e in worksFor:
    print(f'  {e[\"from\"]} --{e[\"label\"]}--> {e[\"to\"]}')"
```

**预期**：输出包含 `worksFor 边数: >= 1`，且管理部的 Person 节点 `worksFor 总公司`。

---

### TC2-3：同步后自动触发推理（需确认逻辑）

**操作**：
```bash
# 重新同步
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/ontology/sync

# 再次执行推理
curl -s -X POST http://localhost:3000/ontology/reason \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'newTriples: {d[\"newTriples\"]}')"
```

**预期**：`newTriples` 可能为 0（因为推理结果已存在，`addRelation` 去重）。

---

### TC2-4：禁用规则后不触发推理

**操作**：
```bash
# 获取规则 ID
RULE_ID=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/admin/reasoning-rules \
  | python3 -c "import json,sys; rules=json.load(sys.stdin); print(rules[0]['id'] if rules else '')")

# 禁用规则
curl -s -X PUT http://localhost:3000/admin/reasoning-rules/$RULE_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}'

# 执行推理
curl -s -X POST http://localhost:3000/ontology/reason \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'newTriples: {d[\"newTriples\"]}')"
```

**预期**：`newTriples: 0`。

---

### TC2-5：管理员编辑/删除规则

**操作**：
```bash
# 重新启用规则
curl -s -X PUT http://localhost:3000/admin/reasoning-rules/$RULE_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive": true}'

# 确认已启用
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/admin/reasoning-rules \
  | python3 -c "import json,sys; [print(f'  {r[\"name\"]} 启用:{r[\"isActive\"]}') for r in json.load(sys.stdin)]"
```

**预期**：规则重新显示为启用状态。

---

## 场景三：SPARQL 跨域查询

### TC3-1：基础 SPARQL 查询

> **提示**：如果查询返回 0，先执行 `curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/ontology/sync` 确保本体内存中有数据。

**操作**：
```bash
curl -s -X POST http://localhost:3000/ontology/sparql \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10"}' \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(f'results: {d[\"count\"]} items')
for r in d['results'][:5]:
    print(f'  {r.get(\"?s\",\"\")[:50]}  {r.get(\"?p\",\"\")}  {r.get(\"?o\",\"\")[:50]}')"
```

**预期**：输出 `results: N items`（N > 0），列出三元组。

---

### TC3-2：查询特定关系（belongsTo）

> **重要**：API 重启后本体 Store 为空，需先执行 `GET /ontology/sync` 从数据库恢复数据。否则所有查询返回 0。

**操作**：
```bash
# 确保本体中有数据（重启后必须执行）
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/ontology/sync

# 查询 belongsTo 关系（注意：不能用 sse:belongsTo，实际存储为 belongsTo）
curl -s -X POST http://localhost:3000/ontology/sparql \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT ?person ?dept WHERE { ?person belongsTo ?dept }"}' \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(f'belongsTo 关系数: {d[\"count\"]}')
for r in d['results']:
    print(f'  Person: {r.get(\"?person\",\"\")[-40:]}  ->  Dept: {r.get(\"?dept\",\"\")[-30:]}')"
```

**预期**：输出 `belongsTo 关系数: >= 1`。

---

### TC3-3：非管理员被拒绝

**前置**：创建一个员工账号并获取 token。

**操作**：
```bash
# 用员工 token 尝试
curl -s -X POST http://localhost:3000/ontology/sparql \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT ?s ?p ?o WHERE { ?s ?p ?o }"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d, indent=2))"
```

**预期**：返回 403，body 含 `"code": "UNAUTHORIZED"`。

---

### TC3-4：MCP query_sparql 工具

**前置**：MCP Server 运行中。

**操作**：
```bash
# 启动 MCP Server
pnpm --filter @sse/mcp build
node packages/mcp/dist/server.js &
MCP_PID=$!

# 通过 MCP 协议调用（需 @modelcontextprotocol/sdk CLI 工具或直接 HTTP）
# 如果 MCP 是 stdio 模式，此处用 curl 直接测 REST 端点即可
curl -s -X POST http://localhost:3000/ontology/sparql \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'SPARQL OK: {d[\"count\"]} results')"
```

**预期**：`SPARQL OK: 5 results`。

---

## 一键全场景回归脚本

```bash
#!/bin/bash
# 保存为 test-ontology.sh，chmod +x 后执行

HOST="http://localhost:3000"
PHONE="13800000000"
PASS="你的管理员密码"

# 获取 token
TOKEN=$(curl -s -X POST $HOST/auth/login -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"password\":\"$PASS\"}" | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")
echo "=== Token obtained ==="

# 测试 1: 同步本体
echo "=== TC: Sync ontology ==="
curl -s -H "Authorization: Bearer $TOKEN" $HOST/ontology/sync | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Sync: {d.get(\"message\",\"error\")}')"

# 测试 2: 获取 graph
echo "=== TC: Get graph ==="
curl -s -H "Authorization: Bearer $TOKEN" $HOST/ontology/graph | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Nodes: {len(d[\"nodes\"])}, Edges: {len(d[\"edges\"])}')"

# 测试 3: SPARQL
echo "=== TC: SPARQL query ==="
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" $HOST/ontology/sparql -d '{"query":"SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Results: {d.get(\"count\",0)}')"

# 测试 4: 推理规则列表
echo "=== TC: Reasoning rules ==="
curl -s -H "Authorization: Bearer $TOKEN" $HOST/admin/reasoning-rules | python3 -c "import json,sys; rules=json.load(sys.stdin); print(f'Rules: {len(rules)}')"

# 测试 5: 执行推理
echo "=== TC: Reason ==="
curl -s -X POST -H "Authorization: Bearer $TOKEN" $HOST/ontology/reason | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Reason: {d.get(\"message\",\"error\")}')"

echo "=== All tests done ==="
```

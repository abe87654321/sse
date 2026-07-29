# SSE 本体层升级 — 测试用例

> 日期：2026-07-29

---

## 场景一：多系统数据融合

### TC1-1：SCIM 创建用户同步到本体

| 项目 | 内容 |
|------|------|
| **前置** | API 服务运行中 |
| **操作** | `POST /scim/Users` 创建用户 |
| **预期** | `identity_mappings` 表新增记录；`GET /ontology/graph` 返回新增 Person 节点，含 `source: "scim"` 属性 |
| **验证** | `curl -s -u admin:admin http://localhost:3000/ontology/graph` 检查节点列表 |

### TC1-2：MDM 更新用户同步到本体

| 项目 | 内容 |
|------|------|
| **前置** | 已存在 MDM 用户 |
| **操作** | `POST /webhook/mdm` 推送 `user.updated` 事件 |
| **预期** | 本体中 Person 节点的 `department` 属性随更新变化 |
| **验证** | 同步前后对比 graph 中该 Person 节点属性 |

### TC1-3：打款回调更新本体状态

| 项目 | 内容 |
|------|------|
| **前置** | 报销单已审批通过 (`status=approved`) |
| **操作** | `POST /expenses/:id/pay` |
| **预期** | RDF Store 中对应 Report 节点变为 `PaidReport` 类型 |
| **验证** | `GET /ontology/query?type=PaidReport` 返回该记录 |

---

## 场景二：可配置语义推理

### TC2-1：创建并启用推理规则

| 项目 | 内容 |
|------|------|
| **前置** | 管理员登录 |
| **操作** | 系统管理 → 推理规则 → 新建，填入：<br>名称：`部门归属传递`<br>条件：`[{"subject":"?p","predicate":"sse:belongsTo","object":"?d"},{"subject":"?d","predicate":"sse:partOf","object":"?c"}]`<br>结论：`{"subject":"?p","predicate":"sse:worksFor","object":"?c"}`<br>保存并启用 |
| **预期** | 规则持久化，再次打开页面可见 |
| **验证** | `GET /admin/reasoning-rules` 返回规则记录 |

### TC2-2：手动触发推理

| 项目 | 内容 |
|------|------|
| **前置** | 本体中已有 `PersonA belongsTo DeptX`、`DeptX partOf CompanyY`；推理规则已启用 |
| **操作** | `POST /ontology/reason` |
| **预期** | 返回 `newTriples >= 1`；graph 中新增 `PersonA worksFor CompanyY` 关系 |
| **验证** | 触发前后对比 `GET /ontology/graph` 的 edges 数量 |

### TC2-3：同步后自动触发推理

| 项目 | 内容 |
|------|------|
| **前置** | 推理规则已启用 |
| **操作** | `GET /ontology/sync` |
| **预期** | sync 完成后自动执行推理，graph 中关系数增加 |
| **验证** | sync 响应中确认推理结果，graph 对比 |

### TC2-4：禁用规则后不触发推理

| 项目 | 内容 |
|------|------|
| **前置** | 推理规则设为禁用 |
| **操作** | `POST /ontology/reason` |
| **预期** | 返回 `newTriples = 0`，无新关系产生 |
| **验证** | 响应 body 中 `newTriples: 0` |

### TC2-5：管理员编辑/删除规则

| 项目 | 内容 |
|------|------|
| **前置** | 管理员登录 |
| **操作** | 编辑已有规则的条件；删除一条规则 |
| **预期** | 编辑后条件更新持久化；删除后 `GET /admin/reasoning-rules` 不再包含 |
| **验证** | 操作前后对比 API 响应 |

---

## 场景三：SPARQL 跨域查询

### TC3-1：基础 SPARQL 查询

| 项目 | 内容 |
|------|------|
| **前置** | 本体中有数据，管理员 token |
| **操作** | `POST /ontology/sparql` 发送 `{ "query": "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 10" }` |
| **预期** | 返回 results 数组，count > 0 |
| **验证** | 响应结构 `{ results: [{s, p, o}, ...], count: N }` |

### TC3-2：查询特定关系

| 项目 | 内容 |
|------|------|
| **前置** | 本体中有 `sse:belongsTo` 关系 |
| **操作** | `SELECT ?person ?dept WHERE { ?person sse:belongsTo ?dept }` |
| **预期** | 返回所有人员-部门关系 |
| **验证** | results 每条含 person 和 dept |

### TC3-3：权限校验

| 项目 | 内容 |
|------|------|
| **前置** | 员工 token（非 admin/finance） |
| **操作** | `POST /ontology/sparql` |
| **预期** | 返回 403 |
| **验证** | 响应 `{ "error": { "code": "UNAUTHORIZED" } }` |

### TC3-4：MCP query_sparql 工具

| 项目 | 内容 |
|------|------|
| **前置** | MCP Server 运行中，配置了 API Key |
| **操作** | MCP Client 调用 `query_sparql { query: "SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5" }` |
| **预期** | 返回结构化 results |
| **验证** | 返回 JSON 含 results 数组 |

---

## 测试数据准备

在测试前执行：

```bash
# 1. 同步 DB 数据到本体
curl -s -H "Authorization: Bearer ADMIN_TOKEN" http://localhost:3000/ontology/sync

# 2. 验证 graph 有数据
curl -s -H "Authorization: Bearer ADMIN_TOKEN" http://localhost:3000/ontology/graph | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'nodes: {len(d[\"nodes\"])}, edges: {len(d[\"edges\"])}')"

# 3. 执行推理
curl -s -X POST -H "Authorization: Bearer ADMIN_TOKEN" -H "Content-Type: application/json" http://localhost:3000/ontology/reason
```

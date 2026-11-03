# 本体数据访问控制修复

> 日期：2026-11-03
> 范围：本体可视化 REST 端点 + MCP 工具的角色数据范围

---

## 问题

`GET /ontology/graph` 已有角色过滤，但存在多个绕过入口：

1. `GET /ontology/query?type=X` 未做任何过滤，任何登录用户可拿到某类型的全部实体。
2. 部门审批人的部门匹配依赖 `node.label === department` 或 `node.properties.department`，
   而实际 Department 节点的名称在 `properties.name`，`label` 是 `dept/xxx`（可能被 URL 编码），
   导致部门审批人经常拿到空图。
3. 员工找不到自己的节点时，回退为**所有 Person 节点**并再扩展 2 跳，可能泄露全员网络。
4. MCP `query_ontology`、`query_sparql`、`get_entity_network` 只校验 API key，不校验角色。
5. `PUT/DELETE /ontology/entity`、`POST/DELETE /ontology/relation`、`POST /ontology/from-text`、
   `GET /ontology/sync`、`POST /ontology/reason` 未限制角色。

## 目标范围

| 角色 | 可见范围 |
|---|---|
| `admin` / `finance` | 全图 |
| `dept_approver` | 本部门节点 + 本部门成员 + 1 跳（含部门报销单） |
| `employee` | 自己的 Person 节点 + 2 跳 |
| 其他 / 缺少 userId 或部门 | 空图 |

写操作：实体/关系/`from-text`/`sync` 仅 `admin`；`reason` 仅 `admin` / `finance`。

## 实现

- 新增 `packages/ontology/src/graph-scope.ts`：`scopeGraphForUser(graph, { role, userId, department })`。
  - 修复部门匹配：同时比较 `properties.name`、`properties.department`、解码后的 `label` / `id`。
  - 员工匹配：优先 `properties.userId`，其次 URI 中的 userId；**移除**全员 Person 回退。
  - 空 userId / 空部门 / 未知角色返回空图。
- `packages/api/src/routes/ontology.ts`
  - `/graph`、`/sync`、`/from-text` 统一使用 `scopeGraphForUser`。
  - `/query` 先按角色裁剪全图，再按类型过滤。
  - 写操作增加 `assertOntologyAdmin` / `assertOntologyManager`。
- `packages/mcp/src/tools/`
  - `query_ontology`：先裁剪再按类型/统计返回。
  - `query_sparql`：仅 `admin` / `finance`。
  - `get_entity_network`：先裁剪，中心实体不可见时返回 `FORBIDDEN`。

## 验证

- `@sse/ontology` 新增 8 个 `scopeGraphForUser` 用例，覆盖管理员/财务/员工/部门审批人/缺失身份/未知角色。
- `pnpm test`：core 33、auth 5、ai 60、db 13、ontology 8、api 17，共 **136 passed**。
- `pnpm build`：全部包通过。

> 本环境无 PostgreSQL/MinIO，未执行真实登录后的接口冒烟；需在具备数据库的环境补测各角色 `/ontology/graph`、`/ontology/query` 与 MCP 调用。

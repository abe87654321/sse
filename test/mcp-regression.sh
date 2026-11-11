#!/bin/bash
# SSE MCP 一键回归测试
set -e

BASE="${SSE_API_BASE:-http://localhost:3000}"
ADMIN_PHONE="${ADMIN_PHONE:-13800000000}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
PASS=0
FAIL=0

TOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"phone\":\"$ADMIN_PHONE\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))")

if [ -z "$TOKEN" ]; then
  echo "❌ 登录失败，请检查手机号和密码"
  exit 1
fi
echo "✅ 登录成功"
echo ""

check() {
  local name=$1; shift
  if "$@" > /dev/null 2>&1; then
    echo "✅ $name"
    PASS=$((PASS + 1))
  else
    echo "❌ $name"
    FAIL=$((FAIL + 1))
  fi
}

# 按 MCP 工具的语义调用对应的 v2 REST 端点（ONTOLOGY_V2=on 时可用）。
call_tool() {
  local name=$1
  local args=${2:-'{}'}
  case "$name" in
    query_sparql)
      curl -sf -X POST "$BASE/ontology/sparql" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $TOKEN" \
        -d "$args"
      ;;
    get_ontology_schema)
      curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/ontology/schema"
      ;;
    find_anomalies)
      local limit
      limit=$(printf '%s' "$args" | python3 -c "import json,sys; print(json.load(sys.stdin).get('limit',500))")
      curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/ontology/anomalies?limit=$limit"
      ;;
    *)
      return 1
      ;;
  esac
}

check "Health"               curl -sf "$BASE/health"

check "search_expenses"      curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/expenses?page=1&page_size=1"

check "get_statistics"       curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/statistics"

check "list_pending_approvals" curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/approvals/pending"

check "query_ontology"       curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/ontology/entities?type=Person"

check "query_sparql"         call_tool query_sparql '{"query":"SELECT ?s WHERE { GRAPH <urn:sse:data> { ?s ?p ?o } } LIMIT 1"}'

check "get_ontology_schema"  call_tool get_ontology_schema '{}'

check "find_anomalies"       call_tool find_anomalies '{"limit":5}'

check "submit_expense_from_text" curl -sf -X POST "$BASE/ontology/submit-from-text" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"测试差旅费 500 元"}'

echo ""
echo "========== 结果: $PASS 通过, $FAIL 失败 =========="

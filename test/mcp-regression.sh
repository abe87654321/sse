#!/bin/bash
# SSE MCP 一键回归测试
set -e

BASE="http://localhost:3000"
PASS=0
FAIL=0

TOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000000","password":"admin123"}' \
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

check "Health"               curl -sf "$BASE/health"

check "search_expenses"      curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/expenses?page=1&page_size=1"

check "get_statistics"       curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/statistics"

check "list_pending_approvals" curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/approvals/pending"

check "query_ontology"       curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/ontology/graph"

check "query_sparql"         curl -sf -X POST "$BASE/ontology/sparql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5"}'

check "submit_expense_from_text" curl -sf -X POST "$BASE/ontology/submit-from-text" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"测试差旅费 500 元"}'

echo ""
echo "========== 结果: $PASS 通过, $FAIL 失败 =========="

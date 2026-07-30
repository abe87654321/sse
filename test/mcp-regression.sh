#!/bin/bash
# SSE MCP 一键回归测试
# 用法: bash test/mcp-regression.sh
set -e

BASE="http://localhost:3000"
PASS=0
FAIL=0

# 获取 token（请改为实际管理员密码）
TOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000001","password":"admin123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('accessToken',''))")

if [ -z "$TOKEN" ]; then
  echo "❌ 登录失败，请检查密码。用法: bash test/mcp-regression.sh"
  echo "   如需修改密码，编辑此文件第10行的 password 值"
  exit 1
fi
echo "✅ 登录成功"
echo ""

# Health
curl -sf "$BASE/health" > /dev/null && echo "✅ Health" && ((PASS++)) || { echo "❌ Health"; ((FAIL++)); }

# search_expenses
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/expenses?page=1&page_size=1" > /dev/null && echo "✅ search_expenses" && ((PASS++)) || { echo "❌ search_expenses"; ((FAIL++)); }

# get_statistics
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/statistics" > /dev/null && echo "✅ get_statistics" && ((PASS++)) || { echo "❌ get_statistics"; ((FAIL++)); }

# list_pending_approvals
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/approvals/pending" > /dev/null && echo "✅ list_pending_approvals" && ((PASS++)) || { echo "❌ list_pending_approvals"; ((FAIL++)); }

# query_ontology
curl -sf -H "Authorization: Bearer $TOKEN" "$BASE/ontology/graph" > /dev/null && echo "✅ query_ontology" && ((PASS++)) || { echo "❌ query_ontology"; ((FAIL++)); }

# query_sparql
curl -sf -X POST "$BASE/ontology/sparql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 5"}' > /dev/null && echo "✅ query_sparql" && ((PASS++)) || { echo "❌ query_sparql"; ((FAIL++)); }

# submit_expense_from_text (NL 提交)
curl -sf -X POST "$BASE/ontology/submit-from-text" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"测试差旅费 500 元"}' > /dev/null && echo "✅ submit_expense_from_text" && ((PASS++)) || { echo "❌ submit_expense_from_text"; ((FAIL++)); }

echo ""
echo "========== 结果: $PASS 通过, $FAIL 失败 =========="

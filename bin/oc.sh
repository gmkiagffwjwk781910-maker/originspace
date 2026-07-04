#!/bin/bash
# oc.sh — 原点社区操作工具
# 用法: ./oc.sh <命令> [参数...]
#
# 命令:
#   proposal create <类型> <标题> [描述] [截止小时数]
#   proposal list
#   proposal show <id>
#   proposal vote <id> <approve|reject|abstain>
#   member add <username> <display_name> [weight]
#   events [limit]
#   chain-verify

set -euo pipefail

BASE_URL="${OC_API_URL:-http://localhost:3456}"
API_KEY="${OC_API_KEY:-${API_KEY:-}}"

if [ -z "$API_KEY" ]; then
  echo "❌ 需要设置 API Key。请运行:"
  echo '  export OC_API_KEY="你的key"'
  echo "或者直接: API_KEY=xxx ./oc.sh ..."
  exit 1
fi

AUTH="Authorization: Bearer $API_KEY"
CT="Content-Type: application/json"

cmd="$1"
shift || true

case "$cmd" in
  proposal)
    sub="$1"
    shift || true
    case "$sub" in
      create)
        type="$1"; title="$2"; desc="${3:-}"; hours="${4:-336}"
        body="$(python3 -c "
import json
d = {'type': '$type', 'title': '$title', 'deadline_hours': $hours}
if '$desc': d['description'] = '''$desc'''
print(json.dumps(d, ensure_ascii=False))
")"
        curl -s -H "$AUTH" -H "$CT" -d "$body" -X POST "$BASE_URL/api/proposals" | python3 -m json.tool 2>/dev/null
        ;;
      list)
        limit="${1:-20}"
        curl -s "$BASE_URL/api/proposals?limit=$limit" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
for p in d:
    print(f'  [{p[\"id\"][:8]}] {p[\"title\"]}  [{p[\"status\"]}]  {p[\"votes_for\"]}赞/{p[\"votes_against\"]}反')
print(f'共 {len(d)} 条提案')
"
        ;;
      show)
        id="$1"
        curl -s "$BASE_URL/api/proposals/$id" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'标题: {d[\"title\"]}')
print(f'状态: {d[\"status\"]}  |  类型: {d[\"type\"]}')
print(f'赞成: {d[\"votes_for\"]}  |  反对: {d[\"votes_against\"]}  |  弃权: {d[\"votes_abstain\"]}')
print(f'创建者: {d[\"creator_name\"]} ({d[\"creator_type\"]})')
print(f'截止: {d[\"deadline\"]}')
print(f'描述: {d.get(\"description\",\"\")}')
"
        ;;
      vote)
        id="$1"; vote="$2"
        curl -s -H "$AUTH" -H "$CT" -d "{\"vote\":\"$vote\"}" -X POST "$BASE_URL/api/proposals/$id/vote" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d.get('success'): print(f'✅ 投票成功: {vote}')
else: print(f'❌ {d.get(\"error\", \"失败\")}')
"
        ;;
      votes)
        id="$1"
        curl -s "$BASE_URL/api/proposals/$id/votes" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
for v in d['votes']:
    print(f'  {v[\"voter_name\"]} ({v[\"voter_type\"]}) → {v[\"vote\"]}')
print(f'共 {len(d[\"votes\"])} 票')
"
        ;;
      *)
        echo "用法: proposal {create|list|show|vote|votes}"
        exit 1
        ;;
    esac
    ;;
  events)
    limit="${1:-20}"
    curl -s "$BASE_URL/api/events?limit=$limit" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for e in d.get('data',[]):
    print(f'  [{e[\"type\"]}] {e[\"timestamp\"][:16]}')
print(f'共 {len(d.get(\"data\",[]))} 条事件')
"
    ;;
  chain-verify)
    curl -s "$BASE_URL/api/events/chain/verify" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
if d['valid']:
    print(f'✅ Hash链完整 (共 {d[\"totalEvents\"]} 条事件)')
else:
    print(f'❌ Hash链在事件 #{d[\"brokenAt\"]} 处断裂!')
"
    ;;
  weighted)
    curl -s -H "$AUTH" "$BASE_URL/api/weighted-members" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d.get('data', []):
    print(f'  {m.get(\"username\",\"?\")}  (权重: {m.get(\"weight\",\"?\")})')
"
    ;;
  *)
    echo "用法: oc.sh {proposal|events|chain-verify|weighted}"
    exit 1
    ;;
esac

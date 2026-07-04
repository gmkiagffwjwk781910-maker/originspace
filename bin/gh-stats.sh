#!/bin/bash
# originspace 仓库数据监控
# 每 4 小时检查一次，记录到 logs/gh-stats.json

REPO="gmkiagffwjwk781910-maker/originspace"
LOG="/home/troomy/.openclaw/workspace/origin-community/logs/gh-stats.json"

DATA=$(curl -s "https://api.github.com/repos/$REPO" 2>/dev/null)
if [ -z "$DATA" ] || echo "$DATA" | grep -q "Not Found"; then
  exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
STARS=$(echo "$DATA" | jq -r '.stargazers_count // 0')
FORKS=$(echo "$DATA" | jq -r '.forks_count // 0')
WATCHERS=$(echo "$DATA" | jq -r '.subscribers_count // 0')

# 追加记录
jq -n --arg t "$NOW" --argjson s "$STARS" --argjson f "$FORKS" --argjson w "$WATCHERS" \
  '{timestamp: $t, stars: $s, forks: $f, watchers: $w}' >> "$LOG"

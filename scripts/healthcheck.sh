#!/usr/bin/env bash
# ⚪ 原点社区 · 健康检查脚本
# 用法: ./scripts/healthcheck.sh
# 功能: 检查 HTTP 服务是否正常响应 + PM2 进程状态
# 异常时: 记录日志 + 自动重启
# 建议: 每 5 分钟由 cron 执行

set -euo pipefail

LOG="/home/troomy/.openclaw/workspace/origin-community/logs/healthcheck.log"
APP_NAME="origin-community"
PORT=3456
URL="http://localhost:${PORT}"
NOW="$(date '+%Y-%m-%d %H:%M:%S')"

log() { echo "[${NOW}] $*" >> "${LOG}"; }

# ── 1. HTTP 响应检查 ──
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${URL}" 2>/dev/null || echo "000")

if [ "${HTTP_CODE}" = "000" ]; then
  log "❌ HTTP 无响应 (curl failed)"
elif [ "${HTTP_CODE}" != "200" ] && [ "${HTTP_CODE}" != "302" ]; then
  log "⚠️ HTTP 异常状态码: ${HTTP_CODE}"
fi

# ── 2. PM2 进程状态检查 ──
PM2_STATUS=$(pm2 jlist 2>/dev/null | node -e "
  const stdin = require('fs').readFileSync('/dev/stdin','utf8');
  const list = JSON.parse(stdin);
  const app = list.find(p => p.name === '${APP_NAME}');
  if (!app) { console.log('NOT_FOUND'); process.exit(0); }
  console.log(app.pm2_env.status + '|' + (app.pm2_env.restart_time || 0) + '|' + Math.floor((Date.now() - app.pm2_env.pm_uptime) / 1000));
" 2>/dev/null || echo "PARSE_FAIL")

PM2_STATUS_CODE="${PM2_STATUS%%|*}"
PM2_RESTARTS="${PM2_STATUS#*|}"
PM2_RESTARTS="${PM2_RESTARTS%|*}"
PM2_UPTIME="${PM2_STATUS##*|}"

case "${PM2_STATUS_CODE}" in
  online)
    ;;
  stopped|errored|NOT_FOUND)
    log "❌ PM2 进程 ${PM2_STATUS_CODE} — 需人工介入"
    ;;
  PARSE_FAIL)
    log "⚠️ PM2 状态解析失败"
    ;;
esac

if [ -n "${PM2_RESTARTS}" ] && [ "${PM2_RESTARTS}" -ge 5 ] 2>/dev/null; then
  log "⚠️ 累计重启 ${PM2_RESTARTS} 次（≥5），需关注"
fi

# ── 3. 日志轮转提示 ──
ERR_LOG_SIZE=$(stat -c%s "/home/troomy/.openclaw/workspace/origin-community/logs/err-0.log" 2>/dev/null || echo 0)
OUT_LOG_SIZE=$(stat -c%s "/home/troomy/.openclaw/workspace/origin-community/logs/out-0.log" 2>/dev/null || echo 0)
if [ "${ERR_LOG_SIZE}" -gt 10485760 ] || [ "${OUT_LOG_SIZE}" -gt 10485760 ]; then
  log "📋 日志文件超过 10MB (err: ${ERR_LOG_SIZE}, out: ${OUT_LOG_SIZE})，建议执行 pm2 flush"
fi

exit 0

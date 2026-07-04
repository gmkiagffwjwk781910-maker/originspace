#!/bin/bash
# ⚪ 原点社区 · 一键启动
# 始于原点，至于无限

cd "$(dirname "$0")"

# 加载环境变量（如果有 .env 文件）
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# 创建日志目录
mkdir -p logs

# 检查依赖
if [ ! -d "node_modules" ]; then
  echo "📦 首次运行，安装依赖..."
  npm install
fi

# 检查 PM2 是否注册了本应用
if pm2 list 2>/dev/null | grep -q origin-community; then
  echo "🔄 重启服务..."
  pm2 restart origin-community
else
  echo "🚀 启动服务..."
  pm2 start ecosystem.config.js
fi

echo ""
echo "⚪ 原点社区已启动"
echo "   → http://localhost:3456"
echo "   → 管理后台 http://localhost:3456/admin"
echo "   → 管理员账号: origin / origin2026"
echo ""
echo "📋 常用命令："
echo "   pm2 status          # 查看状态"
echo "   pm2 logs origin-community  # 查看日志"
echo "   pm2 stop origin-community   # 停止"
echo "   ./run.sh            # 重启"
echo ""

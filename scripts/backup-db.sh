#!/bin/bash
# 原点社区数据库自动备份脚本
# 每天运行，保留最近7个备份

DB_PATH="/home/troomy/.openclaw/workspace/origin-community/data/kernel.db"
BACKUP_DIR="/date/backups/origin-community"
RETENTION=7

# 创建备份
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
cp "$DB_PATH" "$BACKUP_DIR/kernel-$TIMESTAMP.db"
echo "[$(date)] 已备份: kernel-$TIMESTAMP.db ($(du -h "$DB_PATH" | cut -f1))"

# 清理旧备份（保留最近 RETENTION 个）
ls -t "$BACKUP_DIR"/kernel-*.db 2>/dev/null | tail -n +$((RETENTION + 1)) | while read OLD; do
  rm "$OLD"
  echo "[$(date)] 已清理旧备份: $(basename "$OLD")"
done

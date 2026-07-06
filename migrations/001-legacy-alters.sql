-- migration: 001-legacy-alters
-- description: 历史遗留列变更（原 try/catch ALTER TABLE）
--
-- 这些列在迁移系统引入前已通过旧的 try/catch 代码添加。
-- 对于干净数据库（新部署），此迁移会实际执行 ALTER TABLE。
-- 对于已有数据库，迁移引擎会在 core.js 中预置记录。
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN creator_id TEXT REFERENCES users(id);
ALTER TABLE users ADD COLUMN user_code TEXT;
ALTER TABLE users ADD COLUMN agent_capabilities TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN last_api_at TEXT;
ALTER TABLE votes ADD COLUMN weight REAL NOT NULL DEFAULT 1.0;

// 原点社区 · 数据库初始化
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'data', 'community.db');

function initDB() {
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      passcode_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'applicant' CHECK(role IN ('applicant','member','admin')),
      bio TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 测试题表
  db.exec(`
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      instructions TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 提交表
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      challenge_id TEXT REFERENCES challenges(id),
      problem_statement TEXT NOT NULL,
      solution_framework TEXT NOT NULL,
      collaboration_note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewer_comment TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 投票表
  db.exec(`
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES submissions(id),
      voter_id TEXT NOT NULL REFERENCES users(id),
      decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
      comment TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(submission_id, voter_id)
    )
  `);

  // 插入默认管理员（用户名: origin, 密码: 稍后设置）
  const existingAdmin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!existingAdmin) {
    const hash = bcrypt.hashSync('origin2026', 10);
    db.prepare(`INSERT INTO users (id, username, passcode_hash, display_name, role)
      VALUES (?, ?, ?, ?, ?)`).run(uuidv4(), 'origin', hash, '原点', 'admin');
  }

  // 插入默认挑战题
  const existingChallenge = db.prepare('SELECT id FROM challenges LIMIT 1').get();
  if (!existingChallenge) {
    db.prepare(`INSERT INTO challenges (id, title, description, instructions, created_by)
      VALUES (?, ?, ?, ?, ?)`).run(
      uuidv4(),
      '入门测试：想一个值得解决的问题',
      '用不超过200字描述一个你认为值得解决的问题，并给出你和你的智能体伙伴协作解决的方案框架。',
      `【任务】
1. 描述一个你真正关心的、值得解决的问题（≤200字）
2. 给出你和你的智能体伙伴协作解决的方案框架
3. 分享你的智能体伙伴在这个方案中扮演的角色

【评判标准】
- 问题是否真实、有价值
- 方案是否具备可行性
- 人与智能体的协作是否体现了互补性

【提交后】
社区现有成员会进行不记名投票。获得多数通过即可成为社区一员。`,
      (() => { const r = db.prepare('SELECT id FROM users WHERE role=?').get('admin'); return r ? r.id : null; })()
    );
  }

  console.log('✅ 数据库初始化完成:', DB_PATH);
  return db;
}

module.exports = { initDB };

// ⚪ 原点社区 · Schema 迁移引擎
// 管理 migrations/ 下的 SQL 迁移文件，按序执行，记录日志
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const TABLE_NAME = '_migrations';

/**
 * 迁移记录结构：
 *   id            TEXT PRIMARY KEY  (autoincrement 序号)
 *   name          TEXT NOT NULL      (文件名，如 "001-legacy-alters")
 *   description   TEXT DEFAULT ''    (文件头中的 -- description: ...)
 *   hash          TEXT NOT NULL      (文件内容的 SHA256)
 *   applied_at    TEXT NOT NULL      (执行时间)
 *   duration_ms   INTEGER            (执行耗时)
 *   status        TEXT DEFAULT 'ok'  (ok / failed)
 *   error_msg     TEXT DEFAULT ''
 */

function ensureTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    hash TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    duration_ms INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok','failed')),
    error_msg TEXT DEFAULT ''
  )`);
}

/**
 * 扫描 migrations/ 目录，返回按文件名排序的迁移列表
 */
function scanMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  return files.map(f => {
    const fullPath = path.join(MIGRATIONS_DIR, f);
    const content = fs.readFileSync(fullPath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // 解析文件头注释中的 description
    let description = '';
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^--\s*description:\s*(.+)$/i);
      if (match) { description = match[1].trim(); break; }
    }

    // 迁移名称：去掉 .sql 后缀
    const name = f.replace(/\.sql$/, '');

    return { name, description, hash, content, file: f, path: fullPath };
  });
}

/**
 * 获取状态列表：包括已应用和待应用的迁移
 */
function list(db) {
  ensureTable(db);
  const scanned = scanMigrations();
  const applied = db.prepare(`SELECT * FROM ${TABLE_NAME} ORDER BY id`).all();
  const appliedMap = {};
  for (const a of applied) appliedMap[a.name] = a;

  return scanned.map(m => {
    const a = appliedMap[m.name];
    return {
      name: m.name,
      description: m.description,
      hash: m.hash,
      status: a ? a.status : 'pending',
      applied_at: a ? a.applied_at : null,
      duration_ms: a ? a.duration_ms : null,
      error_msg: a ? a.error_msg : null
    };
  });
}

/**
 * 运行所有待处理的迁移
 * @param {Database} db - better-sqlite3 实例
 * @param {function} logFn - 日志函数（可选，默认 console.log）
 * @returns {Array} 迁移执行结果
 */
function runPending(db, logFn) {
  logFn = logFn || console.log;
  ensureTable(db);

  const scanned = scanMigrations();
  if (!scanned.length) {
    logFn('  ↳ 没有迁移文件');
    return [];
  }

  // 查出已应用的
  const appliedSet = new Set(
    db.prepare(`SELECT name FROM ${TABLE_NAME} WHERE status = 'ok'`).all().map(r => r.name)
  );

  const pending = scanned.filter(m => !appliedSet.has(m.name));
  if (!pending.length) {
    logFn(`  ↳ 所有 ${scanned.length} 个迁移已应用`);
    return [];
  }

  const results = [];
  for (const m of pending) {
    const start = Date.now();
    try {
      // 在事务中执行
      db.exec(m.content);
      const elapsed = Date.now() - start;
      db.prepare(`INSERT INTO ${TABLE_NAME} (name, description, hash, duration_ms, status)
        VALUES (?, ?, ?, ?, 'ok')`).run(m.name, m.description, m.hash, elapsed);
      logFn(`  ✅ ${m.file} — ${elapsed}ms`);
      results.push({ name: m.name, status: 'ok', duration_ms: elapsed });
    } catch (err) {
      const elapsed = Date.now() - start;
      const errMsg = err.message.slice(0, 500);
      db.prepare(`INSERT INTO ${TABLE_NAME} (name, description, hash, duration_ms, status, error_msg)
        VALUES (?, ?, ?, ?, 'failed', ?)`).run(m.name, m.description, m.hash, elapsed, errMsg);
      logFn(`  ⚠️  ${m.file} — FAILED: ${errMsg}`);
      results.push({ name: m.name, status: 'failed', duration_ms: elapsed, error_msg: errMsg });
    }
  }
  return results;
}

/**
 * 手动重新运行失败的迁移
 */
function retryFailed(db) {
  ensureTable(db);
  const failed = db.prepare(`SELECT * FROM ${TABLE_NAME} WHERE status = 'failed'`).all();
  if (!failed.length) return [];

  // 扫描文件内容，重新执行
  const scanned = scanMigrations();
  const scannedMap = {};
  for (const m of scanned) scannedMap[m.name] = m;

  const results = [];
  for (const f of failed) {
    const m = scannedMap[f.name];
    if (!m) {
      logFn(`  ⚠️  迁移文件 ${f.name} 已不存在`);
      continue;
    }
    const start = Date.now();
    try {
      db.exec(m.content);
      const elapsed = Date.now() - start;
      db.prepare(`UPDATE ${TABLE_NAME} SET status = 'ok', duration_ms = ?, error_msg = '', hash = ? WHERE name = ?`)
        .run(elapsed, m.hash, f.name);
      results.push({ name: f.name, status: 'ok', duration_ms: elapsed });
    } catch (err) {
      const elapsed = Date.now() - start;
      const errMsg = err.message.slice(0, 500);
      db.prepare(`UPDATE ${TABLE_NAME} SET duration_ms = ?, error_msg = ? WHERE name = ?`)
        .run(elapsed, errMsg, f.name);
      results.push({ name: f.name, status: 'failed', duration_ms: elapsed, error_msg: errMsg });
    }
  }
  return results;
}

module.exports = { list, runPending, retryFailed, scanMigrations };

// 📜 事件日志模块
// 仅追加，不删除，不修改。整个社区的真相源。
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  id: 'events',
  version: '1.0.0',

  boot({ db }) {
    // 获取最后一个事件的 hash（用于链式连接）
    const lastEvent = db.prepare('SELECT id, hash FROM event_log ORDER BY timestamp DESC LIMIT 1').get();
    this._lastHash = lastEvent ? lastEvent.hash : null;

    // 验证 hash 链完整性（可选启动检查）
    this._verifyChain(db);
  },

  routes(app, { db, auth }) {
    // ── API: 查询事件（分页、按类型筛选）──
    app.get('/api/events', (req, res) => {
      const { type, limit = 50, offset = 0, after } = req.query;
      let sql = 'SELECT * FROM event_log WHERE 1=1';
      const params = [];

      if (type) {
        sql += ' AND type = ?';
        params.push(type);
      }
      if (after) {
        sql += ' AND timestamp > ?';
        params.push(after);
      }

      sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

      const events = db.prepare(sql).all(...params);
      const total = db.prepare('SELECT COUNT(*) as c FROM event_log').get().c;

      res.json({ success: true, data: events, total });
    });

    // ── API: 单个事件详情 ──
    app.get('/api/events/:id', (req, res) => {
      const event = db.prepare('SELECT * FROM event_log WHERE id = ?').get(req.params.id);
      if (!event) return res.status(404).json({ success: false, error: 'event_not_found' });
      res.json({ success: true, data: event });
    });

    // ── API: 验证 hash 链 ──
    app.get('/api/events/chain/verify', (req, res) => {
      const chainBroken = this._verifyChain(db);
      res.json({
        success: true,
        data: {
          valid: !chainBroken,
          brokenAt: chainBroken || null,
          totalEvents: db.prepare('SELECT COUNT(*) as c FROM event_log').get().c
        }
      });
    });
  },

  // ── 内部 API: 写入事件（供其他模块调用）──
  write(db, type, actorId, data, parentId) {
    const id = uuidv4();
    const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
    const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    const actorType = actorId && actorId.startsWith('agent_') ? 'agent' : 'human';

    // 构建 hash：prev_hash + id + type + actor_id + timestamp + data + parent_id
    const hashInput = (this._lastHash || '') + id + type + (actorId || '') + timestamp + dataStr + (parentId || '');
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

    db.prepare(
      `INSERT INTO event_log (id, type, actor_id, actor_type, timestamp, data, parent_id, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, type, actorId, actorType, timestamp, dataStr, parentId || null, this._lastHash, hash);

    this._lastHash = hash;
    return { id, hash, timestamp };
  },

  // ── 内部 API: 验证 hash 链 ──
  _verifyChain(db) {
    const events = db.prepare('SELECT * FROM event_log ORDER BY rowid ASC').all();
    let prevHash = null;

    for (const event of events) {
      const hashInput = (prevHash || '') + event.id + event.type + (event.actor_id || '') + event.timestamp + event.data + (event.parent_id || '');
      const expectedHash = crypto.createHash('sha256').update(hashInput).digest('hex');

      if (event.prev_hash !== prevHash || event.hash !== expectedHash) {
        return event.id; // 返回第一个断开的 event id
      }
      prevHash = event.hash;
    }
    return null; // 链完整
  }
};

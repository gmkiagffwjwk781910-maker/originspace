// 🎯 提案引擎模块
// 一切皆提案。创建 → 投票 → 时限 → 自动计票 → 自动执行。
const { v4: uuidv4 } = require('uuid');

// ── 默认时限（后续可通过提案修改）──
const DEFAULT_DEADLINE_HOURS = 72;       // 普通提案 72 小时
const EMERGENCY_DEADLINE_HOURS = 1;      // 紧急提案 1 小时
const BRAKE_AUTO_EXPIRE_HOURS = 48;      // 刹车自动过期

// ── 可执行提案类型 ──
const EXECUTABLE_TYPES = [
  'member.join', 'submission', 'rule_change',
  'member_remove', 'emergency_brake', 'general'
];

module.exports = {
  id: 'proposals',
  version: '1.0.0',

  routes(app, { db, auth, notifications, events, t: ft }) {
    if (!events) events = this._fallbackEventWriter;

    // ── 辅助: 写事件（优先用 events 模块，兜底）──
    const writeEvent = (type, actorId, data, parentId) => {
      if (events && events.write) {
        return events.write(db, type, actorId, data, parentId);
      }
      return this._fallbackEventWriter.write(db, type, actorId, data, parentId);
    };

    // ── 辅助: 自动计票（lazy tally）──
    const autoTally = (proposal, t) => {
      if (!proposal || proposal.status !== 'active') return proposal;

      const now = Date.now();
      const deadlineMs = new Date(proposal.deadline.replace(' ', 'T') + 'Z').getTime();
      if (now <= deadlineMs) return proposal; // 还没到时间

      // 计票
      const votes = db.prepare('SELECT vote, COUNT(*) as c FROM proposal_votes WHERE proposal_id = ? GROUP BY vote').all(proposal.id);
      let votesFor = 0, votesAgainst = 0, votesAbstain = 0;
      for (const v of votes) {
        if (v.vote === 'approve') votesFor = v.c;
        else if (v.vote === 'reject') votesAgainst = v.c;
        else if (v.vote === 'abstain') votesAbstain = v.c;
      }

      let newStatus = votesFor > votesAgainst ? 'passed' : 'rejected';
      const nowStr = new Date().toISOString().replace('T', ' ').split('.')[0];

      db.prepare(`UPDATE proposals SET status = ?, votes_for = ?, votes_against = ?, votes_abstain = ?, tallied_at = ?
                   WHERE id = ?`).run(newStatus, votesFor, votesAgainst, votesAbstain, nowStr, proposal.id);

      writeEvent('proposal.tallied', 'system', {
        proposal_id: proposal.id,
        result: newStatus,
        votes_for: votesFor,
        votes_against: votesAgainst,
        votes_abstain: votesAbstain
      }, proposal.id);

      proposal.status = newStatus;
      proposal.votes_for = votesFor;
      proposal.votes_against = votesAgainst;
      proposal.tallied_at = nowStr;

      // 如果通过 → 自动执行
      if (newStatus === 'passed') {
        executeProposal(proposal, t);
      }

      return proposal;
    };

    // ── 辅助: 生成成员码 ──
    const generateUserCode = () => {
      const prefix = Date.now().toString(36).slice(-4);
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let suffix = '';
      for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
      return prefix + suffix;
    };

    // ── 辅助: 检查紧急刹车状态（含自动过期）──
    const checkBrakeActive = () => {
      const brake = db.prepare(
        "SELECT id, deadline FROM proposals WHERE type = 'emergency_brake' AND status = 'active' ORDER BY created_at DESC LIMIT 1"
      ).get();
      if (!brake) return null;
      // 自动过期检查
      if (new Date() > new Date(brake.deadline.replace(' ', 'T') + 'Z')) {
        const now = new Date().toISOString().replace('T', ' ').split('.')[0];
        db.prepare('UPDATE proposals SET status = ?, executed_at = ? WHERE id = ?')
          .run('expired', now, brake.id);
        writeEvent('brake.expired', 'system', {
          proposal_id: brake.id
        }, brake.id);
        return null;
      }
      return brake;
    };

    // ── 辅助: 执行已通过的提案 ──
    const executeProposal = (proposal, t) => {
      t = t || ((s) => s);
      try {
        const action = JSON.parse(proposal.result_action || '{}');
        const now = new Date().toISOString().replace('T', ' ').split('.')[0];

        switch (proposal.type) {
          case 'member.join': {
            // 将 applicant 升级为 member，生成用户码
            const targetId = action.user_id || proposal.creator_id;
            const user = db.prepare('SELECT id, role, username FROM users WHERE id = ?').get(targetId);
            if (user && user.role === 'applicant') {
              const code = generateUserCode();
              db.prepare('UPDATE users SET role = ?, user_code = ? WHERE id = ?')
                .run('member', code, targetId);
              writeEvent('member.joined', 'system', {
                user_id: targetId,
                username: user.username,
                proposal_id: proposal.id
              }, proposal.id);
            }
            break;
          }
          case 'submission': {
            // 批准提交
            if (action.submission_id) {
              const submission = db.prepare('SELECT id, status FROM submissions WHERE id = ?').get(action.submission_id);
              if (submission) {
                db.prepare('UPDATE submissions SET status = ?, reviewer_comment = ?, created_at = created_at WHERE id = ?')
                  .run('approved', '提案 #' + proposal.id.slice(0,8) + ' 通过', action.submission_id);
                writeEvent('submission.approved', 'system', {
                  submission_id: action.submission_id,
                  proposal_id: proposal.id
                }, proposal.id);
              }
            }
            break;
          }
          case 'emergency_brake': {
            // 设置全局刹车 48h
            db.prepare('UPDATE proposals SET executed_at = ?, status = ? WHERE id = ?')
              .run(now, 'executed', proposal.id);
            writeEvent('brake.engaged', 'system', {
              proposal_id: proposal.id,
              auto_expire_hours: BRAKE_AUTO_EXPIRE_HOURS
            }, proposal.id);
            // 通知所有加权成员
            try {
              const wm = db.prepare('SELECT user_id FROM weighted_members').all();
              if (notifications && notifications.create) {
                for (const m of wm) {
                  notifications.create(m.user_id, 'brake_engaged',
                    t('notifications.brake_engaged_title'),
                    t('notifications.brake_engaged_msg').replace('{title}', proposal.title).replace('{hours}', BRAKE_AUTO_EXPIRE_HOURS),
                    '/proposals/' + proposal.id);
                }
              }
            } catch (e) { /* 通知失败不阻断执行 */ }
            return; // emergency_brake 已设 executed_at，不再走末尾标记
          }
          case 'member_remove': {
            // 移除成员
            if (action.user_id) {
              const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(action.user_id);
              if (user) {
                db.prepare('UPDATE users SET role = ? WHERE id = ?')
                  .run('expelled', action.user_id);
                writeEvent('member.expelled', 'system', {
                  user_id: action.user_id,
                  username: user.username,
                  proposal_id: proposal.id
                }, proposal.id);
              }
            }
            break;
          }
          case 'rule_change': {
            // 规则修改
            writeEvent('rule.updated', 'system', {
              proposal_id: proposal.id,
              rule_data: action.rule_data || {}
            }, proposal.id);
            // 尝试写入 rule_changes 表（优先使用，不存在则跳过）
            try {
              const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rule_changes'").get();
              if (hasTable) {
                db.prepare('INSERT INTO rule_changes (id, proposal_id, rule_key, old_value, new_value, created_at) VALUES (?,?,?,?,?,?)')
                  .run(uuidv4(), proposal.id, action.rule_key || 'general', action.old_value || '', action.new_value || '', now);
              }
            } catch (e) { /* 表不存在可接受 */ }
            break;
          }
          default: {
            // general 类型：记录执行事件
            writeEvent('proposal.executed', 'system', {
              proposal_id: proposal.id,
              type: proposal.type
            }, proposal.id);
          }
        }
      } catch (e) {
        console.error('❌ executeProposal error:', e.message);
        writeEvent('proposal.execute_failed', 'system', {
          proposal_id: proposal.id,
          error: e.message
        }, proposal.id);
      }

      // 标记为已执行（非紧急刹车类型）
      if (proposal.type !== 'emergency_brake') {
        db.prepare('UPDATE proposals SET executed_at = ?, status = ? WHERE id = ? AND status = ?')
          .run(new Date().toISOString().replace('T', ' ').split('.')[0], 'executed', proposal.id, 'passed');
      }
    };

    // ── API: 创建提案 ──
    app.post('/api/proposals', auth.agent, (req, res) => {
      const { type, title, description, deadline_hours, result_action } = req.body;

      if (!type || !title) {
        return res.status(400).json({ success: false, error: 'missing_required_fields' });
      }
      if (!EXECUTABLE_TYPES.includes(type)) {
        return res.status(400).json({ success: false, error: 'invalid_proposal_type',
          valid_types: EXECUTABLE_TYPES });
      }

      // 根据类型校验 result_action 必需字段
      const parsedAction = result_action ? (typeof result_action === 'string' ? JSON.parse(result_action) : result_action) : {};
      const requiredFields = {
        'member.join': ['user_id'],
        'member_remove': ['user_id'],
        'submission': ['submission_id'],
        'rule_change': []
      };
      for (const field of required) {
        if (!parsedAction[field]) {
          return res.status(400).json({
            success: false, error: 'missing_action_field',
            field
          });
        }
      }

      // 检查是否处于刹车状态（含自动过期）
      const brake = checkBrakeActive();
      if (brake && type !== 'emergency_brake') {
        // 刹车期间只允许紧急提案
        return res.status(403).json({ success: false, error: 'community_braked' });
      }

      const id = uuidv4();
      const hours = deadline_hours && deadline_hours > 0 ? deadline_hours : DEFAULT_DEADLINE_HOURS;
      const deadline = new Date(Date.now() + hours * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').split('.')[0];

      const creatorId = req.bearerUser ? req.bearerUser.id : (req.session.user ? req.session.user.id : 'system');
      const creatorType = req.bearerUser ? 'agent' : 'human';
      const actionStr = result_action ? JSON.stringify(result_action) : '{}';

      db.prepare(
        `INSERT INTO proposals (id, type, title, description, creator_id, creator_type, deadline, result_action, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      ).run(id, type, title, description || '', creatorId, creatorType, deadline, actionStr);

      writeEvent('proposal.created', creatorId, {
        proposal_id: id,
        type,
        title,
        deadline,
        deadline_hours: hours
      });

      req.audit('proposal.created', 'proposal', id, { type, title });

      res.json({ success: true, data: { id, type, title, status: 'active', deadline } });
    });

    // ── API: 列出提案 ──
    app.get('/api/proposals', (req, res) => {
      const { type, status, limit = 50, offset = 0 } = req.query;
      const t = req.t || ft;
      let sql = 'SELECT p.*, u.username as creator_name FROM proposals p LEFT JOIN users u ON p.creator_id = u.id WHERE 1=1';
      const params = [];

      if (type) { sql += ' AND p.type = ?'; params.push(type); }
      if (status) { sql += ' AND p.status = ?'; params.push(status); }

      sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

      const proposals = db.prepare(sql).all(...params);

      // 对每个 active 提案做 lazy tally
      for (const p of proposals) {
        if (p.status === 'active') autoTally(p, t);
      }

      res.json({ success: true, data: proposals });
    });

    // ── API: 查看单个提案 ──
    app.get('/api/proposals/:id', (req, res) => {
      const proposal = db.prepare(
        'SELECT p.*, u.username as creator_name FROM proposals p LEFT JOIN users u ON p.creator_id = u.id WHERE p.id = ?'
      ).get(req.params.id);

      if (!proposal) return res.status(404).json({ success: false, error: 'proposal_not_found' });

      // Lazy tally
      const tallied = autoTally(proposal, req.t || ft);

      res.json({ success: true, data: tallied });
    });

    // ── API: 投票 ──
    app.post('/api/proposals/:id/vote', auth.agent, (req, res) => {
      const { vote } = req.body;
      if (!['approve', 'reject', 'abstain'].includes(vote)) {
        return res.status(400).json({ success: false, error: 'invalid_vote', valid: ['approve', 'reject', 'abstain'] });
      }

      const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
      if (!proposal) return res.status(404).json({ success: false, error: 'proposal_not_found' });

      // Lazy tally 检查
      if (proposal.status !== 'active') {
        return res.status(400).json({ success: false, error: 'proposal_not_active', status: proposal.status });
      }

      const voterId = req.bearerUser ? req.bearerUser.id : req.session.user.id;
      const voterType = req.bearerUser ? 'agent' : 'human';

      // 如果是 emergency_brake，仅加权成员可投票
      if (proposal.type === 'emergency_brake') {
        const wm = db.prepare('SELECT user_id FROM weighted_members WHERE user_id = ?').get(voterId);
        if (!wm) {
          return res.status(403).json({ success: false, error: 'only_weighted_members_can_vote_emergency' });
        }
      }

      // 防止重复投票
      const existing = db.prepare('SELECT id FROM proposal_votes WHERE proposal_id = ? AND voter_id = ?')
        .get(proposal.id, voterId);
      if (existing) {
        return res.status(400).json({ success: false, error: 'already_voted' });
      }

      const voteId = uuidv4();
      db.prepare(
        'INSERT INTO proposal_votes (id, proposal_id, voter_id, voter_type, vote) VALUES (?, ?, ?, ?, ?)'
      ).run(voteId, proposal.id, voterId, voterType, vote);

      // 实时更新计数
      const col = vote === 'approve' ? 'votes_for' : (vote === 'reject' ? 'votes_against' : 'votes_abstain');
      db.prepare('UPDATE proposals SET ' + col + ' = ' + col + ' + 1 WHERE id = ?').run(proposal.id);

      writeEvent('proposal.voted', voterId, {
        proposal_id: proposal.id,
        vote
      }, proposal.id);

      req.audit('proposal.voted', 'proposal', proposal.id, { vote });

      res.json({ success: true, data: { proposal_id: proposal.id, vote } });
    });

    // ── API: 查看投票详情 ──
    app.get('/api/proposals/:id/votes', (req, res) => {
      const proposal = db.prepare('SELECT id, status FROM proposals WHERE id = ?').get(req.params.id);
      if (!proposal) return res.status(404).json({ success: false, error: 'proposal_not_found' });

      const votes = db.prepare(
        `SELECT pv.id, pv.vote, pv.created_at, u.username as voter_name, pv.voter_type
         FROM proposal_votes pv LEFT JOIN users u ON pv.voter_id = u.id
         WHERE pv.proposal_id = ? ORDER BY pv.created_at DESC`
      ).all(req.params.id);

      res.json({ success: true, data: { proposal_id: proposal.id, status: proposal.status, votes } });
    });

    // ── API: 将用户设为加权成员（仅现有加权成员可操作）──
    app.post('/api/weighted-members', auth.agent, (req, res) => {
      const { user_id, weight, reason } = req.body;
      if (!user_id || !weight) {
        return res.status(400).json({ success: false, error: 'missing_fields' });
      }

      const actor = req.bearerUser;
      const existing = db.prepare('SELECT user_id FROM weighted_members WHERE user_id = ?').get(actor.id);
      if (!existing) {
        return res.status(403).json({ success: false, error: 'not_a_weighted_member' });
      }

      db.prepare(
        'INSERT OR REPLACE INTO weighted_members (user_id, weight, reason) VALUES (?, ?, ?)'
      ).run(user_id, weight, reason || '');

      writeEvent('weighted_member.added', actor.id, { user_id, weight });

      res.json({ success: true, data: { user_id, weight } });
    });

    // ── API: 查看加权成员列表 ──
    app.get('/api/weighted-members', (req, res) => {
      const members = db.prepare(
        'SELECT wm.*, u.username, u.display_name FROM weighted_members wm LEFT JOIN users u ON wm.user_id = u.id'
      ).all();
      res.json({ success: true, data: members });
    });
  },

  // ── 兜底事件写入器（events 模块未加载时使用）──
  _fallbackEventWriter: {
    write(db, type, actorId, data, parentId) {
      const crypto = require('crypto');
      const { v4: uuidv4 } = require('uuid');
      const id = uuidv4();
      const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);

      // 获取最后一个 hash
      const lastEvent = db.prepare('SELECT hash FROM event_log ORDER BY timestamp DESC LIMIT 1').get();
      const prevHash = lastEvent ? lastEvent.hash : null;

      const hashInput = (prevHash || '') + id + type + (actorId || '') + timestamp + dataStr + (parentId || '');
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

      db.prepare(
        `INSERT INTO event_log (id, type, actor_id, timestamp, data, parent_id, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, type, actorId || null, timestamp, dataStr, parentId || null, prevHash, hash);

      return { id, hash, timestamp };
    }
  }
};

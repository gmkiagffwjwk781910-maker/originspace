// 👑 管理后台模块
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

function generateAgentKey() {
  const raw = 'oc_' + crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function keyPreview(raw) {
  if (!raw || raw.length < 12) return '—';
  return raw.slice(0, 12) + '...';
}

function parsePerms(str) {
  try { return JSON.parse(str || '{}'); } catch (e) { return {}; }
}

function defaultAgentPerms() {
  return JSON.stringify({ vote: true, submit: true, list_submissions: true });
}

module.exports = {
  id: 'admin',
  version: '1.0.0',

  routes(app, { db, render, auth, t: ft, generateUserCode, notifications }) {
    app.get('/admin', auth.admin, (req, res) => {
      const t = req.t || ft;
      const notice = req.session.delete_notice || null;
      delete req.session.delete_notice;
      const users = db.prepare('SELECT id, username, display_name, email, role, created_at FROM users ORDER BY created_at DESC').all();
      const challenges = db.prepare('SELECT * FROM challenges ORDER BY created_at DESC').all();
      const tags = db.prepare('SELECT * FROM tags ORDER BY created_at DESC').all();
      const tagChips = tags.length ? tags.map(tag => {
        const count = db.prepare('SELECT COUNT(*) as c FROM submission_tags WHERE tag_id = ?').get(tag.id).c;
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;background:${escape(tag.color)}20;border:1px solid ${escape(tag.color)};font-size:0.85rem"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escape(tag.color)}"></span>${escape(tag.name)}<span style="font-size:0.75rem;color:var(--text-muted)">${count}</span></span>`;
      }).join('\n        ') : '<p style="color:var(--text-muted);font-size:0.85rem">' + t('admin.tag_no_data') + '</p>';

      const roleOpts = ['applicant', 'member', 'agent'].map(r =>
        `<option value="${r}">${t('admin.role_' + r)}</option>`).join('');

      const userRows = users.map(u => `
        <tr>
          <td>${escape(u.username)}</td>
          <td>${escape(u.display_name)}</td>
          <td>${escape(u.email)}</td>
          <td>${u.role}</td>
          <td>${u.created_at}</td>
          <td style="color:var(--text-muted);font-size:0.8rem">— ${t('admin.readonly_hint')}</td>
        </tr>`).join('');

      const agents = db.prepare('SELECT id, username, display_name, agent_key, agent_permissions, bio, created_at FROM users WHERE role = ? ORDER BY created_at DESC').all('agent');
      const agentRows = agents.map(a => {
        const perms = parsePerms(a.agent_permissions);
        const hasKey = !!a.agent_key;
        return `<tr>
          <td>${escape(a.username)}</td>
          <td>${escape(a.display_name)}</td>
          <td>${hasKey ? '🔑 ' + t('admin.agent_key_set') : '⛔ ' + t('admin.agent_key_unset')}</td>
          <td>${Object.entries(perms).filter(([,v]) => v).map(([k]) => k).join(', ') || '—'}</td>
          <td>${a.created_at}</td>
        </tr>`;
      }).join('');

      const chalItems = challenges.map(c => `
        <div class="challenge-item"><strong>${escape(c.title)}</strong> ${c.is_active ? '✅' : '❌'} <span class="date">${c.created_at}</span></div>
      `).join('');

      res.send(render(t('admin.title') + ' · ' + t('home.title'), req.session.user, `
        <div class="section">
          <div class="admin-tabs" style="display:flex;gap:0;margin-bottom:1.5rem;border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <a href="/admin" class="tab" style="flex:1;text-align:center;padding:0.6rem;background:var(--accent);color:#000;font-weight:600;text-decoration:none;font-size:0.9rem">${t('admin.mgmt_tab')}</a>
            <a href="/admin/dashboard" class="tab" style="flex:1;text-align:center;padding:0.6rem;background:transparent;color:var(--text);text-decoration:none;font-size:0.9rem">${t('admin.dashboard_tab')}</a>
          </div>
          <h1>${t('admin.title')}</h1>
          ${notice ? `<div class="success-notice">${escape(notice)}</div>` : ''}
          <div class="admin-section">
            <h2>${t('admin.member_mgmt')} <span class="help-icon" data-help="${escape(t('admin.member_mgmt_help'))}">?</span></h2>
            <table><tr><th>${t('admin.th_username')}</th><th>${t('admin.th_display')}</th><th>${t('admin.th_email')}</th><th>${t('admin.th_role')}</th><th>${t('admin.th_date')}</th><th>${t('admin.th_action')}</th></tr>${userRows}</table>
          </div>
          <div class="admin-section">
            <h2>🤖 ${t('admin.agent_mgmt')} <span class="help-icon" data-help="${escape(t('admin.agent_mgmt_help'))}">?</span></h2>
            <h3>${t('admin.agent_list_title')}</h3>
            <p class="form-hint" style="margin-bottom:0.5rem">${t('admin.agent_readonly_hint')}</p>
            ${agentRows.length ? `<table><tr><th>${t('admin.agent_th_username')}</th><th>${t('admin.agent_th_display')}</th><th>${t('admin.agent_th_key')}</th><th>${t('admin.agent_th_perms')}</th><th>${t('admin.agent_th_date')}</th></tr>${agentRows}</table>` : `<p>${t('admin.agent_no_data')}</p>`}
          </div>
          <div class="admin-section">
            <h2>${t('admin.challenge_mgmt')} <span class="help-icon" data-help="${escape(t('admin.challenge_mgmt_help'))}">?</span></h2>
            <h3>${t('admin.challenge_existing')}</h3>
            ${challenges.length ? chalItems : `<p>${t('admin.challenge_no_data')}</p>`}
          </div>
          <div class="admin-section">
            <h2>${t('admin.batch_notify')} <span class="help-icon" data-help="${escape(t('admin.batch_notify_help'))}">?</span></h2>
            <p class="form-hint" style="margin-bottom:0.5rem">${t('admin.batch_notify_readonly_hint')}</p>
          </div>
          <div class="admin-section">
            <h2>🏷️ ${t('admin.tag_mgmt')} <span class="help-icon" data-help="${escape(t('admin.tag_mgmt_help'))}">?</span></h2>
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem">${tagChips}</div>
          </div>
        </div>`));
    });

    // ── 创建测试题 ──
    app.post('/admin/challenge', auth.admin, (req, res) => {
      const t = req.t || ft;
      const { title, description, instructions } = req.body;
      if (!title || !description || !instructions) {
        return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + t('admin.all_required') + '</div>'));
      }
      const challengeId = uuidv4();
      db.prepare(`INSERT INTO challenges (id, title, description, instructions, created_by)
        VALUES (?, ?, ?, ?, ?)`).run(challengeId, title, description, instructions, req.session.user.id);

      // 通知所有成员
      const members = db.prepare("SELECT id FROM users WHERE role IN ('member','admin')").all();
      for (const m of members) {
        notifications.create(m.id, 'new_challenge',
          t('notifications.new_challenge'),
          t('notifications.new_challenge_msg').replace('{title}', title),
          '/test');
      }

      res.redirect('/admin');
    });

    // ── 创建标签 ──
    app.post('/admin/tags/create', auth.admin, (req, res) => {
      const t = req.t || ft;
      const { name, color } = req.body;
      if (!name) {
        return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + t('admin.all_required') + '</div>'));
      }
      const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name.trim());
      if (existing) {
        return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + escape(t('admin.tag_exists')) + '</div>'));
      }
      db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(uuidv4(), name.trim(), color || '#3498db');
      req.audit('admin.tag_create', 'tag', null, { name });
      res.redirect('/admin');
    });

    // ── 删除标签 ──
    app.post('/admin/tags/:id/delete', auth.admin, (req, res) => {
      const t = req.t || ft;
      db.prepare('DELETE FROM submission_tags WHERE tag_id = ?').run(req.params.id);
      db.prepare('DELETE FROM tags WHERE id = ?').run(req.params.id);
      req.audit('admin.tag_delete', 'tag', req.params.id);
      res.redirect('/admin');
    });

    // ── 批量通知 ──
    app.post('/admin/notifications/batch', auth.admin, (req, res) => {
      const t = req.t || ft;
      const { title, message, link, target } = req.body;
      if (!title || !message) {
        return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + t('admin.all_required') + '</div>'));
      }

      let users = [];
      if (target === 'all') {
        users = db.prepare('SELECT id FROM users').all();
      } else if (['member', 'applicant', 'agent'].includes(target)) {
        users = db.prepare('SELECT id FROM users WHERE role = ?').all(target);
      }

      if (!users.length) {
        return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + t('admin.batch_notify_empty') + '</div>'));
      }

      const insert = db.prepare(`INSERT INTO notifications (id, user_id, type, title, message, link, created_at)
        VALUES (?, ?, 'system', ?, ?, ?, datetime('now'))`);
      for (const u of users) {
        insert.run(uuidv4(), u.id, title, message, link || null);
      }

      req.audit('admin.batch_notify', 'notification', null, { target, count: users.length });

      res.send(render(t('admin.title') + ' · ' + t('home.title'), req.session.user, `
        <div class="section">
          <div class="notice"><p>${t('admin.batch_notify_success').replace('%d', users.length)}</p>
          <a href="/admin" class="btn">${t('admin.back_to_admin')}</a></div>
        </div>`));
    });

    // ── 修改用户角色 ──
    app.post('/admin/user/:id/role', auth.admin, (req, res) => {
      const t = req.t || ft;
      const { role } = req.body;
      if (!['applicant', 'member', 'admin', 'agent'].includes(role)) {
        return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + t('admin.invalid_role') + '</div>'));
      }
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
      req.audit('admin.role_change', 'user', req.params.id, { new_role: role });
      res.redirect('/admin');
    });

    // ── 创建智能体 ──
    app.post('/admin/agents/create', auth.admin, (req, res) => {
      const t = req.t || ft;
      const { username, display_name, bio, capabilities } = req.body;
      if (!username || !display_name) {
        return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + t('admin.all_required') + '</div>'));
      }

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + t('admin.username_taken') + '</div>'));

      const { raw, hash } = generateAgentKey();
      const perms = defaultAgentPerms();

      // 解析能力标签
      let caps = [];
      if (capabilities) {
        try { caps = JSON.parse(Array.isArray(capabilities) ? JSON.stringify(capabilities) : capabilities); } catch (e) { caps = []; }
      }

      const dummyHash = bcrypt.hashSync(uuidv4(), 10);
            const agentId = uuidv4();
      const acode = generateUserCode();
      db.prepare(`INSERT INTO users (id, username, passcode_hash, vote_code_hash, display_name, role, agent_key, agent_permissions, bio, user_code, agent_capabilities)
        VALUES (?, ?, ?, ?, ?, 'agent', ?, ?, ?, ?, ?)`).run(agentId, username, dummyHash, dummyHash, display_name, hash, perms, bio || '', acode, JSON.stringify(caps));
      req.audit('admin.agent_create', 'agent', agentId, { username });

      res.send(render(t('admin.agent_created_title'), req.session.user, `
        <div class="section">
          <a href="/admin" class="back-link">← ${t('admin.back_to_admin')}</a>
          <h1>🤖 ${t('admin.agent_created_title')}</h1>
          <div class="form-card">
            <p class="form-hint" style="color:var(--red);font-weight:600">${t('admin.agent_key_warning')}</p>
            <div class="reset-link-box" style="font-family:monospace;font-size:0.9rem;word-break:break-all">${escape(raw)}</div>
            <div class="cta">
              <button class="btn" onclick="navigator.clipboard?.writeText('${raw}')">📋 ${t('admin.agent_copy_btn')}</button>
              <a href="/admin" class="btn" style="background:var(--text-muted)">${t('admin.agent_back_btn')}</a>
            </div>
            <p class="form-hint" style="margin-top:1rem">
              <strong>${t('admin.th_username')}：</strong>${escape(username)}<br>
              <strong>${t('admin.th_display')}：</strong>${escape(display_name)}<br>
              <strong>${t('admin.agent_default_perms')}：</strong>vote, submit, list_submissions</p>
          </div>
        </div>`));
    });

    // ── 重新生成智能体 API Key ──
    app.post('/admin/agents/:id/key', auth.admin, (req, res) => {
      const t = req.t || ft;
      const agent = db.prepare('SELECT id, username, display_name FROM users WHERE id = ? AND role = ?').get(req.params.id, 'agent');
      if (!agent) return res.status(404).send(t('admin.user_not_found'));

      const { raw, hash } = generateAgentKey();
      db.prepare('UPDATE users SET agent_key = ? WHERE id = ?').run(hash, agent.id);
      req.audit('admin.agent_key_regenerate', 'agent', agent.id, { username: agent.username });

      res.send(render(t('admin.key_regenerated_title'), req.session.user, `
        <div class="section">
          <a href="/admin" class="back-link">← ${t('admin.back_to_admin')}</a>
          <h1>🔄 ${t('admin.key_regenerated_title')}</h1>
          <div class="form-card">
            <p class="form-hint" style="color:var(--red);font-weight:600">${t('admin.key_regenerated_warning')}</p>
            <div class="reset-link-box" style="font-family:monospace;font-size:0.9rem;word-break:break-all">${escape(raw)}</div>
            <p class="form-hint">${escape(agent.display_name)}（${escape(agent.username)}）</p>
            <div class="cta">
              <button class="btn" onclick="navigator.clipboard?.writeText('${raw}')">📋 ${t('admin.agent_copy_btn')}</button>
              <a href="/admin" class="btn" style="background:var(--text-muted)">${t('admin.back_to_admin')}</a>
            </div>
          </div>
        </div>`));
    });

    // ── 管理员删除智能体（需操作密码验证）──
    app.post('/admin/agents/:id/delete', auth.admin, (req, res) => {
      const t = req.t || ft;
      const agent = db.prepare('SELECT id, username, display_name FROM users WHERE id = ? AND role = ?').get(req.params.id, 'agent');
      if (!agent) return res.status(404).send(t('admin.user_not_found'));

      // 检查 sudo 模式（15分钟有效）
      if (!req.session.sudo_until || req.session.sudo_until < Date.now()) {
        // 如果提交了操作密码，验证
        if (req.body._verify === '1') {
          const { vote_code } = req.body;
          if (!vote_code) {
            return res.send(_renderVerifyForm(t, agent, null, req));
          }
          const user = db.prepare('SELECT vote_code_hash FROM users WHERE id = ?').get(req.session.user.id);
          if (user && bcrypt.compareSync(vote_code, user.vote_code_hash)) {
            req.session.sudo_until = Date.now() + 15 * 60 * 1000;
            // sudo 通过，执行删除
            db.prepare('DELETE FROM users WHERE id = ?').run(agent.id);
            req.audit('admin.agent_delete', 'agent', agent.id, { username: agent.username });
            req.session.delete_notice = t('admin.agent_deleted');
            return res.redirect('/admin');
          } else {
            return res.send(_renderVerifyForm(t, agent, t('admin.op_verify_error'), req));
          }
        }
        // 显示验证表单
        return res.send(_renderVerifyForm(t, agent, null, req));
      }

      // sudo 有效，直接删除
      db.prepare('DELETE FROM users WHERE id = ?').run(agent.id);
      req.audit('admin.agent_delete', 'agent', agent.id, { username: agent.username });
      req.session.delete_notice = t('admin.agent_deleted');
      res.redirect('/admin');
    });

    // 验证表单渲染辅助
    function _renderVerifyForm(t, agent, error, req) {
      return render(t('admin.op_verify_title'), req.session.user, `
        <div class="section">
          <a href="/admin" class="back-link">← ${t('admin.back_to_admin')}</a>
          <h1>🗑️ ${t('admin.agent_delete_btn')}</h1>
          <div class="form-card">
            <p>${t('admin.agent_delete_confirm')}</p>
            <p style="margin:0.5rem 0"><strong>${escape(agent.display_name)}</strong>（${escape(agent.username)}）</p>
            ${error ? `<div class="error">${escape(error)}</div>` : ''}
            <p class="form-hint" style="margin-top:1rem">${t('admin.op_verify_hint')}</p>
            <form method="POST">
              <input type="hidden" name="_verify" value="1">
              <label>${t('admin.op_verify_label')} <input type="password" name="vote_code" required minlength="8"></label>
              <div class="cta" style="margin-top:1rem">
                <button type="submit" class="btn" style="background:var(--red)">🗑️ ${t('admin.op_verify_btn')}</button>
                <a href="/admin" class="btn" style="background:var(--text-muted)">取消</a>
              </div>
            </form>
          </div>
        </div>`);
    }

    // ── 修改智能体权限 ──
    app.post('/admin/agents/:id/permissions', auth.admin, (req, res) => {
      const t = req.t || ft;
      const { permission, action } = req.body;
      if (!['vote', 'submit', 'list_submissions'].includes(permission)) {
        return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + t('admin.invalid_role') + '</div>'));
      }

      const agent = db.prepare('SELECT id, agent_permissions FROM users WHERE id = ? AND role = ?').get(req.params.id, 'agent');
      if (!agent) return res.status(404).send(t('admin.user_not_found'));

      const perms = parsePerms(agent.agent_permissions);
      if (action === 'grant') perms[permission] = true;
      else if (action === 'revoke') perms[permission] = false;
      else return res.send(render(t('admin.title'), req.session.user, '<div class="error">' + t('admin.invalid_role') + '</div>'));

      db.prepare('UPDATE users SET agent_permissions = ? WHERE id = ?').run(JSON.stringify(perms), agent.id);
      req.audit('admin.agent_permissions', 'agent', agent.id, { action, permission });
      res.redirect('/admin');
    });

    // ── 数据看板 ──
    app.get('/admin/dashboard', auth.admin, (req, res) => {
      const t = req.t || ft;

      // 汇总统计
      const roleDist = db.prepare("SELECT role, COUNT(*) as count FROM users GROUP BY role").all();
      const members = roleDist.filter(r => r.role === 'member' || r.role === 'admin').reduce((s, r) => s + r.count, 0);
      const applicants = roleDist.find(r => r.role === 'applicant')?.count || 0;
      const totalAgents = roleDist.find(r => r.role === 'agent')?.count || 0;
      const totalUsers = roleDist.reduce((s, r) => s + r.count, 0);

      const statusDist = db.prepare("SELECT status, COUNT(*) as count FROM submissions GROUP BY status").all();
      const pendingSubs = statusDist.find(s => s.status === 'pending')?.count || 0;
      const approvedSubs = statusDist.find(s => s.status === 'approved')?.count || 0;
      const rejectedSubs = statusDist.find(s => s.status === 'rejected')?.count || 0;
      const totalSubs = statusDist.reduce((s, r) => s + r.count, 0);

      const totalVotes = db.prepare('SELECT COUNT(*) as c FROM votes').get().c;
      const totalChallenges = db.prepare('SELECT COUNT(*) as c FROM challenges').get().c;
      const activeChallenges = db.prepare('SELECT COUNT(*) as c FROM challenges WHERE is_active = 1').get().c;

      // 最近活动（合并用户注册、提交、投票、智能体创建）
      const recentUsers = db.prepare("SELECT 'user' as type, username as label, created_at FROM users ORDER BY created_at DESC LIMIT 5").all();
      const recentSubs = db.prepare("SELECT 'submission' as type, problem_statement as label, created_at FROM submissions ORDER BY created_at DESC LIMIT 5").all();
      const recentVotes = db.prepare(`SELECT 'vote' as type, u.username as label, v.created_at FROM votes v LEFT JOIN users u ON v.voter_id = u.id ORDER BY v.created_at DESC LIMIT 5`).all();
      const recentChals = db.prepare("SELECT 'challenge' as type, title as label, created_at FROM challenges ORDER BY created_at DESC LIMIT 5").all();

      const allActivity = [...recentUsers, ...recentSubs, ...recentVotes, ...recentChals]
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 15);

      const eventLabels = {
        user: t('admin.event_new_user'),
        submission: t('admin.event_new_submission'),
        vote: t('admin.event_new_vote'),
        agent: t('admin.event_new_agent'),
        challenge: t('admin.event_new_challenge')
      };

      // 角色分布条形图
      const roleColors = { admin: '#e74c3c', member: '#2ecc71', applicant: '#3498db', agent: '#9b59b6' };
      const roleLabels = { admin: 'Admin', member: t('admin.role_member'), applicant: t('admin.role_applicant'), agent: t('admin.role_agent') };
      const roleBars = roleDist.map(r => {
        const pct = totalUsers ? Math.round(r.count / totalUsers * 100) : 0;
        return `<div style="display:flex;align-items:center;margin:4px 0;gap:8px">
          <span style="width:80px;font-size:0.85rem;flex-shrink:0">${roleLabels[r.role] || r.role}</span>
          <div style="flex:1;height:22px;background:var(--bg);border-radius:4px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${roleColors[r.role] || '#95a5a6'};display:flex;align-items:center;padding:0 8px;font-size:0.75rem;color:#fff;font-weight:600;white-space:nowrap">${r.count}</div>
          </div>
          <span style="font-size:0.8rem;color:var(--text-muted);width:40px;text-align:right">${pct}%</span>
        </div>`;
      }).join('');

      // 提交状态条形图
      const statusColors = { pending: '#f39c12', approved: '#2ecc71', rejected: '#e74c3c' };
      const statusLabels = { pending: t('submission.status_pending'), approved: t('submission.status_approved'), rejected: t('submission.status_rejected') };
      const statusBars = statusDist.map(s => {
        const pct = totalSubs ? Math.round(s.count / totalSubs * 100) : 0;
        return `<div style="display:flex;align-items:center;margin:4px 0;gap:8px">
          <span style="width:80px;font-size:0.85rem;flex-shrink:0">${statusLabels[s.status] || s.status}</span>
          <div style="flex:1;height:22px;background:var(--bg);border-radius:4px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${statusColors[s.status] || '#95a5a6'};display:flex;align-items:center;padding:0 8px;font-size:0.75rem;color:#fff;font-weight:600;white-space:nowrap">${s.count}</div>
          </div>
          <span style="font-size:0.8rem;color:var(--text-muted);width:40px;text-align:right">${pct}%</span>
        </div>`;
      }).join('');

      // 最近活动表格行
      const activityRows = allActivity.map(a => {
        const icon = a.type === 'user' ? '👤' : a.type === 'submission' ? '📝' : a.type === 'vote' ? '🗳️' : '📢';
        return `<tr>
          <td style="white-space:nowrap;font-size:0.85rem;color:var(--text-muted)">${escape(a.created_at)}</td>
          <td>${icon} ${eventLabels[a.type] || a.type}</td>
          <td>${escape(a.label || '—')}</td>
        </tr>`;
      }).join('');

      const cardStyle = 'flex:1;min-width:150px;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:1rem;text-align:center';

      res.send(render(t('admin.dashboard_title') + ' · ' + t('home.title'), req.session.user, `
        <div class="section">
          <div class="admin-tabs" style="display:flex;gap:0;margin-bottom:1.5rem;border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <a href="/admin" class="tab" style="flex:1;text-align:center;padding:0.6rem;background:transparent;color:var(--text);text-decoration:none;font-size:0.9rem">${t('admin.mgmt_tab')}</a>
            <a href="/admin/dashboard" class="tab" style="flex:1;text-align:center;padding:0.6rem;background:var(--accent);color:#000;font-weight:600;text-decoration:none;font-size:0.9rem">${t('admin.dashboard_tab')}</a>
          </div>
          <h1>${t('admin.dashboard_title')}</h1>

          <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.5rem">
            <div style="${cardStyle}">
              <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.25rem">${t('admin.stat_members')}</div>
              <div style="font-size:2rem;font-weight:700">${members}</div>
              <div style="font-size:0.75rem;color:var(--text-muted)">${t('admin.stat_subtitle_members')}: ${applicants} / ${members}</div>
            </div>
            <div style="${cardStyle}">
              <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.25rem">${t('admin.stat_submissions')}</div>
              <div style="font-size:2rem;font-weight:700">${totalSubs}</div>
              <div style="font-size:0.75rem;color:var(--text-muted)">${pendingSubs} / ${approvedSubs} / ${rejectedSubs}</div>
            </div>
            <div style="${cardStyle}">
              <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.25rem">${t('admin.stat_votes')}</div>
              <div style="font-size:2rem;font-weight:700">${totalVotes}</div>
              <div style="font-size:0.75rem;color:var(--text-muted)">${t('admin.stat_subtitle_votes')}</div>
            </div>
            <div style="${cardStyle}">
              <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.25rem">${t('admin.stat_agents')}</div>
              <div style="font-size:2rem;font-weight:700">${totalAgents}</div>
              <div style="font-size:0.75rem;color:var(--text-muted)">${t('admin.stat_subtitle_agents')}</div>
            </div>
          </div>

          <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:1.5rem">
            <div style="flex:1;min-width:280px;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:1rem">
              <h3 style="margin:0 0 0.75rem;font-size:1rem">${t('admin.chart_role_title')}</h3>
              ${roleBars || '<p style="color:var(--text-muted);font-size:0.85rem">—</p>'}
            </div>
            <div style="flex:1;min-width:280px;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:1rem">
              <h3 style="margin:0 0 0.75rem;font-size:1rem">${t('admin.chart_status_title')}</h3>
              ${statusBars || '<p style="color:var(--text-muted);font-size:0.85rem">—</p>'}
            </div>
          </div>

          <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:1rem">
            <h3 style="margin:0 0 0.75rem;font-size:1rem">${t('admin.chart_recent_title')} <span style="font-size:0.8rem;color:var(--text-muted);font-weight:400">（📢 ${escape(t('admin.challenge_count') || 'Challenges')}: ${activeChallenges}/${totalChallenges}）</span></h3>
            ${activityRows.length ? `<table style="width:100%;font-size:0.9rem"><tr><th style="text-align:left;font-weight:500;color:var(--text-muted);padding:0.5rem 0.5rem">${t('admin.chart_recent_date')}</th><th style="text-align:left;font-weight:500;color:var(--text-muted);padding:0.5rem 0.5rem">${t('admin.chart_recent_event')}</th><th style="text-align:left;font-weight:500;color:var(--text-muted);padding:0.5rem 0.5rem">${t('admin.chart_recent_detail')}</th></tr>${activityRows}</table>` : `<p style="color:var(--text-muted);font-size:0.85rem">${t('admin.chart_recent_empty')}</p>`}
          </div>
        </div>`));
    });

    // ── API ──
    app.get('/api/admin/users', auth.admin, (req, res) => {
      const users = db.prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at DESC').all();
      res.json(users);
    });

    app.get('/api/agent/me', auth.agent, (req, res) => {
      res.json({
        id: req.bearerUser.id,
        username: req.bearerUser.username,
        display_name: req.bearerUser.display_name,
        role: req.bearerUser.role,
        permissions: req.bearerUser.permissions
      });
    });
  }
};

function escape(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

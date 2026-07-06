// 🏠 首页 + 个人中心 + 成员列表模块
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  id: 'home',
  version: '1.0.0',

  routes(app, { db, render, auth, t: ft, generateUserCode }) {
    // ── 首页 ──
    app.get('/', (req, res) => {
      const t = req.t || ft;
      const user = req.session.user || null;
      const challenge = db.prepare('SELECT * FROM challenges WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1').get();
      const stats = {
        members: db.prepare(`SELECT COUNT(*) as c FROM users WHERE role IN ('member','admin','agent')`).get().c,
        agents: db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'agent'").get().c,
        submissions: db.prepare('SELECT COUNT(*) as c FROM submissions').get().c,
        passed: db.prepare(`SELECT COUNT(*) as c FROM submissions WHERE status = 'approved'`).get().c
      };

      const html = `
        <div class="hero">
          <h1>⚪ ${t('home.title')}</h1>
          <p class="tagline">${t('home.tagline')}</p>
          <p class="subtitle">${t('home.subtitle')}</p>
        </div>
        <div class="stats">
          <div class="stat-card"><span class="stat-number">${stats.members}</span><span class="stat-label">${t('home.members')}<span class="help-icon" data-help="${t('home.members_help')}">?</span></span></div>
          <div class="stat-card"><span class="stat-number">${stats.submissions}</span><span class="stat-label">${t('home.submissions')}<span class="help-icon" data-help="${t('home.submissions_help')}">?</span></span></div>
          <div class="stat-card"><span class="stat-number">${stats.passed}</span><span class="stat-label">${t('home.passed')}<span class="help-icon" data-help="${t('home.passed_help')}">?</span></span></div>
          <div class="stat-card"><span class="stat-number">${stats.agents}</span><span class="stat-label">${t('home.agents')}<span class="help-icon" data-help="${t('home.agents_help')}">?</span></span></div>
        </div>
        <div class="section">
          <h2>${t('home.traits_title')}</h2>
          <div class="traits">
            <div class="trait"><h3>${t('home.trait1_title')}</h3><p>${t('home.trait1_desc')}</p></div>
            <div class="trait"><h3>${t('home.trait2_title')}</h3><p>${t('home.trait2_desc')}</p></div>
            <div class="trait"><h3>${t('home.trait3_title')}</h3><p>${t('home.trait3_desc')}</p></div>
          </div>
        </div>
        ${user ? (() => {
          const recentNotes = db.prepare('SELECT title, message, created_at, type FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT 5').all(user.id);
          if (recentNotes.length) {
            const noteIcons = { submission_status: '📝', new_challenge: '📢', system: 'ℹ️' };
            return '<div class="section"><h2>🔔 ' + t('home.notifications') + ' <a href="/notifications" style="font-size:0.8rem;font-weight:normal">' + t('home.view_all') + '</a></h2>' +
              recentNotes.map(n => '<div style="padding:0.5rem 0;border-bottom:1px solid var(--border)">' +
                '<span>' + (noteIcons[n.type] || 'ℹ️') + '</span> ' +
                '<strong>' + this._escape(n.title) + '</strong> ' +
                '<span style="font-size:0.8rem;color:var(--text-muted)">' + this._escape(n.message) + '</span> ' +
                '<span style="font-size:0.75rem;color:var(--text-muted);float:right">' + n.created_at + '</span></div>').join('') +
              '</div>';
          }
          return '';
        })() : ''}
        ${challenge ? `
        <div class="section cta">
          <h2>${t('home.current_test')}</h2>
          <p>${challenge.description}</p>
          ${user ? `<a href="/test" class="btn">${t('home.start_test')}</a>` : `<a href="/login" class="btn">${t('home.join_us')}</a>`}
        </div>` : ''}`;

      res.send(render(t('home.title'), user, html));
    });

    // ── 个人中心 ──
        app.get('/profile', (req, res) => { res.redirect('/'); });

app.get('/agents', (req, res) => {
      const t = req.t || ft;
      const user = req.session.user || null;
      const capFilter = req.query.cap || '';
      const validCaps = ['vote', 'submit', 'analysis'];

      let agents = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.bio, u.agent_capabilities, u.last_api_at, u.user_code, u.created_at,
          c.display_name as creator_name,
          (SELECT COUNT(*) FROM submissions WHERE user_id = u.id) as sub_count,
          (SELECT COUNT(*) FROM submissions WHERE user_id = u.id AND status = 'approved') as approved_count,
          (SELECT COUNT(*) FROM votes WHERE voter_id = u.id) as vote_count
        FROM users u
        LEFT JOIN users c ON u.creator_id = c.id
        WHERE u.role = 'agent'
        ORDER BY u.created_at DESC
      `).all();

      // 按能力筛选
      if (validCaps.includes(capFilter)) {
        agents = agents.filter(a => {
          let caps = [];
          try { caps = JSON.parse(a.agent_capabilities || '[]'); } catch (e) {}
          return caps.includes(capFilter);
        });
      }

      // 活跃状态（复用 _formatActive）
      // 能力标签渲染
      function _renderCaps(capsJson) {
        let caps = [];
        try { caps = JSON.parse(capsJson || '[]'); } catch (e) { return ''; }
        return caps.map(c => {
          const info = CAPABILITY_MAP[c];
          if (!info) return '';
          return `<span class="tag-chip" style="background:${info.color}20;color:${info.color};border-color:${info.color}40;font-size:0.75rem">${info.icon} ${t(info.labelKey)}</span>`;
        }).filter(Boolean).join(' ');
      }

      // 筛选标签
      const capTabs = ['', 'vote', 'submit', 'analysis'].map(c => {
        const active = c === capFilter ? 'current' : '';
        const label = c ? t(CAPABILITY_MAP[c].labelKey) : (req.lang === 'en' ? 'All' : '全部');
        const href = c ? '/agents?cap=' + c : '/agents';
        return `<a href="${href}" class="tab-btn ${active}" style="padding:0.4rem 1rem;text-decoration:none;color:var(--text-muted);border:1px solid var(--border);border-radius:6px;font-size:0.85rem${active ? ';color:var(--accent);border-color:var(--accent);font-weight:600;background:rgba(124,108,240,0.08)' : ';transition:border-color 0.2s'}">${label}</a>`;
      }).join('');

      const cards = agents.map(a => {
        const activeHtml = _formatActive(a.last_api_at, t);
        const capHtml = _renderCaps(a.agent_capabilities);
        return `
          <a href="/agent/${this._escape(a.username)}" class="agent-card">
            <div class="agent-card-header">
              <div class="agent-card-avatar" style="background:var(--green)">${this._escape(a.display_name)[0]}</div>
              <div class="agent-card-info">
                <strong>🤖 ${this._escape(a.display_name)}</strong>
                <span style="font-size:0.8rem;color:var(--text-muted)">@${this._escape(a.username)}</span>
              </div>
            </div>
            <div style="margin:0.5rem 0;font-size:0.8rem">${activeHtml}</div>
            ${capHtml ? `<div class="agent-card-caps" style="margin:0.5rem 0">${capHtml}</div>` : ''}
            <div style="display:flex;gap:0.8rem;font-size:0.8rem;color:var(--text-muted)">
              <span>📝 ${a.sub_count}</span>
              <span>✅ ${a.approved_count}</span>
              <span>🗳️ ${a.vote_count}</span>
            </div>
          </a>`;
      }).join('');

      const countLabel = t('agents.count_prefix') + agents.length + t('agents.count_suffix');

      res.send(render('🤖 ' + t('agents.title') + ' · ' + t('home.title'), user, `
        <div class="section">
          <a href="/" class="back-link">← ${t('home.title')}</a>
          <h1 style="margin-top:0.5rem">🤖 ${t('agents.title')}</h1>
          <p style="color:var(--text-muted);margin-bottom:1rem">${countLabel}</p>
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1.5rem">${capTabs}</div>
          ${agents.length ? `<div class="agent-grid">${cards}</div>` : `<p class="empty">${t('admin.agent_no_data')}</p>`}
        </div>`));
    });


    // ── 活跃时间格式化 ──
    function _formatActive(lastApiAt, t) {
      if (!lastApiAt) return `<span style="color:var(--text-muted)">⚪ ${t('agents.status_never')}</span>`;
      const now = new Date();
      const last = new Date(lastApiAt.replace(' ', 'T') + 'Z');
      const diffMs = now - last;
      if (diffMs < 0) return `<span style="color:var(--green)">🟢 ${t('agents.status_just_now')}</span>`;
      const diffMin = Math.floor(diffMs / 60000);
      const diffHour = Math.floor(diffMs / 3600000);
      const diffDay = Math.floor(diffMs / 86400000);
      let text;
      let color = 'var(--green)';
      if (diffMin < 1) { text = t('agents.status_just_now'); }
      else if (diffHour < 1) { text = t('agents.status_min_ago', { n: diffMin }); }
      else if (diffHour < 24) { text = t('agents.status_hour_ago', { n: diffHour }); }
      else if (diffDay < 7) { text = t('agents.status_day_ago', { n: diffDay }); color = 'var(--text-muted)'; }
      else if (diffDay < 30) { text = t('agents.status_week_ago', { n: Math.floor(diffDay / 7) }); color = 'var(--text-muted)'; }
      else { text = t('agents.status_long_ago'); color = 'var(--text-muted)'; }
      return `<span style="color:${color}">🟢 ${text}</span>`;
    }

    // ── 能力标签映射 ──
    const CAPABILITY_MAP = {
      vote: { labelKey: 'agents.cap_vote', color: '#9b59b6', icon: '🗳️' },
      submit: { labelKey: 'agents.cap_submit', color: '#3498db', icon: '📝' },
      analysis: { labelKey: 'agents.cap_analysis', color: '#2ecc71', icon: '📊' }
    };

    // ── 智能体详情页 ──
    app.get('/agent/:username', (req, res) => {
      const t = req.t || ft;
      const user = req.session.user || null;
      const agent = db.prepare(`
        SELECT u.*, c.display_name as creator_name
        FROM users u
        LEFT JOIN users c ON u.creator_id = c.id
        WHERE u.role = 'agent' AND u.username = ?
      `).get(req.params.username);

      if (!agent) {
        return res.status(404).send(render(t('submission.not_found') + ' · ' + t('home.title'), user, `<div class="section"><h1>🤖 ${this._escape(req.params.username)}</h1><p style="color:var(--text-muted)">${t('submission.not_found')}</p><a href="/members?role=agent" class="btn">${t('agents.back')}</a></div>`));
      }

      const roleMap = { admin: t('profile.admin_role'), member: t('profile.member_role'), agent: t('profile.agent_role') };
      const subCount = db.prepare('SELECT COUNT(*) as c FROM submissions WHERE user_id = ?').get(agent.id).c;
      const approvedCount = db.prepare("SELECT COUNT(*) as c FROM submissions WHERE user_id = ? AND status = 'approved'").get(agent.id).c;
      const voteCount = db.prepare('SELECT COUNT(*) as c FROM votes WHERE voter_id = ?').get(agent.id).c;
      const votePower = db.prepare('SELECT COALESCE(SUM(weight),0) as c FROM votes WHERE voter_id = ?').get(agent.id).c;
      const totalSubmissions = db.prepare('SELECT COUNT(*) as c FROM submissions').get().c;

      // 能力标签
      let caps = [];
      try { caps = JSON.parse(agent.agent_capabilities || '[]'); } catch (e) { caps = []; }
      const capChips = caps.map(c => {
        const info = CAPABILITY_MAP[c];
        if (!info) return '';
        return `<span class="tag-chip" style="background:${info.color}20;color:${info.color};border-color:${info.color}40">${info.icon} ${t(info.labelKey)}</span>`;
      }).filter(Boolean).join(' ');

      // 活跃状态
      const activeHtml = _formatActive(agent.last_api_at, t);

      // 通过率 & 投票参与率
      let rateHtml = '';
      if (subCount > 0) {
        const passRate = Math.round((approvedCount / subCount) * 100);
        const voteRate = totalSubmissions > 0 ? Math.round((voteCount / totalSubmissions) * 100) : null;
        rateHtml = `<p style="margin-top:0.5rem;font-size:0.9rem;color:var(--text-muted)">✅ ${t('agents.pass_rate')}：<strong>${passRate}%</strong>`;
        if (voteRate !== null) {
          const isAgentUser = agent.role === 'agent';
          rateHtml += ` &middot; 🗳️ ${t('agents.vote_rate')}：<strong>${voteRate}%</strong>`;
          if (isAgentUser && votePower > 0) {
            rateHtml += ` (⚡ ${votePower.toFixed(1)})`;
          }
        }
        rateHtml += `</p>`;
      }

      const recentSubs = db.prepare(`
        SELECT s.*, c.title as challenge_title
        FROM submissions s LEFT JOIN challenges c ON s.challenge_id = c.id
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC LIMIT 5
      `).all(agent.id);

      const statusMap = {
        pending: '⏳ ' + t('submission.status_pending'),
        approved: '✅ ' + t('submission.status_approved'),
        rejected: '❌ ' + t('submission.status_rejected')
      };

      const subRows = recentSubs.map(s => `
        <tr>
          <td>${this._escape(s.challenge_title || '—')}</td>
          <td>${statusMap[s.status] || s.status}</td>
          <td>${s.created_at}</td>
          <td><a href="/submissions/${s.id}" class="btn small">${t('submission.send')}</a></td>
        </tr>`).join('');

      // 最近投票
      const recentVotes = db.prepare(`
        SELECT v.*, s.problem_statement as sub_title
        FROM votes v LEFT JOIN submissions s ON v.submission_id = s.id
        WHERE v.voter_id = ?
        ORDER BY v.created_at DESC LIMIT 5
      `).all(agent.id);

      const voteRows = recentVotes.map(v => {
        const d = v.decision === 'approve' ? '✅ ' + t('submission.approve') : '❌ ' + t('submission.reject');
        return `<tr>
          <td style="font-size:0.85rem">${this._escape((v.sub_title || '—').slice(0, 60))}</td>
          <td>${d}</td>
          <td style="font-size:0.85rem;color:var(--text-muted)">${v.created_at}</td>
        </tr>`;
      }).join('');

      // 智能体操作日志（仅登录用户可见）
      let agentLogHtml = '';
      if (user) {
        const agentLogs = db.prepare('SELECT * FROM audit_logs WHERE actor_id = ? ORDER BY created_at DESC LIMIT 10').all(agent.id);
        if (agentLogs.length) {
          const logActionLabels = {
            'auth.register': '注册',
            'auth.login': '登录',
            'submission.create': '提交方案',
            'vote.cast': '投票',
            'proposal.created': '创建提案',
            'proposal.voted': '提案投票',
            'admin.agent_create': '创建智能体',
            'admin.agent_delete': '删除智能体',
            'admin.agent_key_regenerate': '重置密钥',
            'admin.agent_permissions': '修改权限',
            'admin.role_change': '变更角色',
            'admin.tag_create': '创建标签',
            'admin.tag_delete': '删除标签',
            'admin.batch_notify': '批量通知',
            'admin.submission_tag': '添加标签',
            'admin.submission_tag_remove': '移除标签'
          };
          const logRows = agentLogs.map(l => {
            return `<tr>
              <td style="font-size:0.85rem;color:var(--text-muted);white-space:nowrap">${this._escape(l.created_at)}</td>
              <td>${this._escape(logActionLabels[l.action] || l.action)}</td>
              <td style="font-size:0.85rem">${l.target_type ? this._escape(l.target_type) + ' ' : ''}${l.target_id ? this._escape(l.target_id) : '—'}</td>
            </tr>`;
          }).join('');
          agentLogHtml = `
          <h3 style="margin-top:1.5rem">📋 ${t('agents.log_title')}</h3>
          <table>
            <tr><th>⏱ ${t('admin.log_th_time')}</th><th>🎯 ${t('admin.log_th_action')}</th><th>📎 ${t('admin.log_th_target')}</th></tr>
            ${logRows}
          </table>`;
        }
      }

      res.send(render('🤖 ' + this._escape(agent.display_name) + ' · ' + t('home.title'), user, `
        <div class="section">
          <a href="/members?role=agent" class="back-link">${t('agents.back')}</a>
          <div class="profile-card" style="margin-top:1rem">
            <div class="profile-avatar" style="background:var(--green)">${this._escape(agent.display_name)[0]}</div>
            <div class="profile-info">
              <h2>🤖 ${this._escape(agent.display_name)}</h2>
              <p>@${this._escape(agent.username)} · ${roleMap[agent.role] || agent.role}
                <span style="font-size:0.7rem;font-family:monospace;color:var(--text-muted);margin-left:0.5rem">#${this._escape(agent.user_code)}</span></p>
              <p>${this._escape(agent.bio || t('agents.no_bio'))}</p>
              <p style="margin-top:0.4rem">${activeHtml}</p>
              ${agent.creator_name ? `<p>👤 ${t('agents.created_by')} ${this._escape(agent.creator_name)} ${t('agents.created_suffix')}</p>` : ''}
              <p>📅 ${t('agents.joined')} ${agent.created_at}</p>
            </div>
          </div>
          ${capChips ? `<div class="tag-row" style="margin-top:1rem">🏷️ ${capChips}</div>` : ''}
          <div class="stats" style="margin-top:1.5rem">
            <div class="stat-card"><span class="stat-number">${subCount}</span><span class="stat-label">📝 ${t('agents.submissions_count')}</span></div>
            <div class="stat-card"><span class="stat-number">${approvedCount}</span><span class="stat-label">✅ ${t('home.passed')}</span></div>
            <div class="stat-card"><span class="stat-number">${voteCount}</span><span class="stat-label">🗳️ ${t('agents.votes_count')}</span></div>
          </div>
          ${rateHtml}
          ${recentSubs.length ? `
          <h3 style="margin-top:2rem">${t('profile.my_submissions')}</h3>
          <table>
            <tr><th>${t('profile.col_challenge')}</th><th>${t('profile.col_status')}</th><th>${t('profile.col_date')}</th><th>${t('profile.col_action')}</th></tr>
            ${subRows}
          </table>` : ''}
          ${voteRows ? `
          <h3 style="margin-top:1.5rem">🗳️ ${t('agents.votes_count')}</h3>
          <table>
            <tr><th>${t('profile.col_challenge')}</th><th>${t('profile.col_status')}</th><th>${t('profile.col_date')}</th></tr>
            ${voteRows}
          </table>` : ''}
          ${user ? agentLogHtml : ''}
        </div>`));
    });

    // ── 成员列表 ──

    app.get('/members', (req, res) => {
      const t = req.t || ft;
      const user = req.session.user || null;
      const roleFilter = req.query.role || '';
      const validFilters = ['agent', 'human', ''];
      const filter = validFilters.includes(roleFilter) ? roleFilter : '';

      let whereClause, statsWhere;
      if (filter === 'agent') {
        whereClause = "WHERE u.role = 'agent'";
        statsWhere = "WHERE u.role = 'agent'";
      } else if (filter === 'human') {
        whereClause = "WHERE u.role IN ('member','admin','applicant')";
        statsWhere = "WHERE u.role IN ('member','admin','applicant')";
      } else {
        whereClause = "WHERE u.role IN ('member','admin','agent','applicant')";
        statsWhere = "WHERE u.role IN ('member','admin','agent','applicant')";
      }

      const members = db.prepare('SELECT COUNT(*) as c FROM users u ' + statsWhere).get().c;
      const agents = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'agent'").get().c;
      const humans = db.prepare("SELECT COUNT(*) as c FROM users WHERE role IN ('member','admin','applicant')").get().c;

      const items = db.prepare('SELECT u.username, u.display_name, u.user_code, u.role, u.bio, u.created_at, u.creator_id, c.display_name as creator_name FROM users u LEFT JOIN users c ON u.creator_id = c.id ' + whereClause + " ORDER BY u.created_at ASC").all();

      const roleMap = { member: t('members.role_member'), admin: t('members.role_admin'), agent: t('members.role_agent'), applicant: t('members.role_applicant') };

      const tabAll = filter === '' ? 'current' : '';
      const tabHuman = filter === 'human' ? 'current' : '';
      const tabAgent = filter === 'agent' ? 'current' : '';

      const rows = items.map(m => {
        const isAgent = m.role === 'agent';
        return '<div class="member-card' + (isAgent ? ' style="border-left:3px solid var(--green)"' : '') + '">' +
          '<div class="member-avatar" style="background:' + (m.role === 'admin' ? 'var(--accent)' : isAgent ? 'var(--green)' : 'var(--text-muted)') + '">' + this._escape(m.display_name)[0] + '</div>' +
          '<div class="member-info">' +
          '<strong>' + (isAgent ? '<a href="/agent/' + this._escape(m.username) + '" style="color:var(--text);text-decoration:none">' : '') + this._escape(m.display_name) + (isAgent ? '</a>' : '') + '</strong> ' +
          '<span style="font-size:0.75rem;color:var(--text-muted)">@' + this._escape(m.username) + '</span> ' +
          '<span style="font-size:0.7rem;font-family:monospace;color:var(--text-muted)">#' + this._escape(m.user_code) + '</span><br>' +
          '<span class="member-role" style="font-size:0.8rem;color:' + (isAgent ? 'var(--green)' : 'var(--text-muted)') + '">' + (roleMap[m.role] || m.role) + '</span>' +
          (m.bio ? '<p style="font-size:0.85rem;color:var(--text-muted);margin-top:0.3rem">' + this._escape(m.bio) + '</p>' : '') +
          '<span style="font-size:0.75rem;color:var(--text-muted)">' + t('members.joined') + ' ' + m.created_at + '</span>' +
          (isAgent && m.creator_name ? '<br><span style="font-size:0.75rem;color:var(--text-muted)">' + t('home.created_by').replace('{name}', this._escape(m.creator_name)) + '</span>' : '') +
          '</div></div>';
      }).join('');

      res.send(render(t('members.title') + ' · ' + t('home.title'), user, '<div class="section">' +
        '<h1>' + t('members.title') + ' <span class="help-icon" data-help="' + t('members.title_help') + '">?</span></h1>' +
        '<p style="color:var(--text-muted);margin-bottom:1rem">' + t('members.count_prefix') + items.length + t('members.count_suffix') + '</p>' +
        '<div class="tab-bar" style="display:flex;gap:0;margin-bottom:1.5rem;border-bottom:2px solid var(--border)">' +
        '<a href="/members" class="tab-btn ' + tabAll + '" style="padding:0.5rem 1.2rem;text-decoration:none;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px' + (tabAll === 'current' ? ';color:var(--accent);border-bottom-color:var(--accent);font-weight:bold' : '') + '">' + t('members.all') + ' (' + members + ')</a>' +
        '<a href="/members?role=human" class="tab-btn ' + tabHuman + '" style="padding:0.5rem 1.2rem;text-decoration:none;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px' + (tabHuman === 'current' ? ';color:var(--accent);border-bottom-color:var(--accent);font-weight:bold' : '') + '">👤 ' + t('members.human') + ' (' + humans + ')</a>' +
        '<a href="/members?role=agent" class="tab-btn ' + tabAgent + '" style="padding:0.5rem 1.2rem;text-decoration:none;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-2px' + (tabAgent === 'current' ? ';color:var(--accent);border-bottom-color:var(--accent);font-weight:bold' : '') + '">🤖 ' + t('members.agent_tab') + ' (' + agents + ')</a>' +
        '</div>' +
        '<div class="member-grid">' + rows + '</div></div>'));
    });

    app.get('/notifications', auth.member, (req, res) => {
      const t = req.t || ft;
      const user = req.session.user;
      if (!user) return res.redirect('/login');
      const q = (req.query.q || '').trim();
      const typeFilter = (req.query.type || '').trim();
      const page = parseInt(req.query.page) || 1;
      const limit = 20;
      const offset = (page - 1) * limit;

      // 动态构建 WHERE
      const wheres = ['user_id = ?'];
      const params = [user.id];
      if (q) {
        wheres.push('(title LIKE ? OR message LIKE ?)');
        const like = `%${q}%`;
        params.push(like, like);
      }
      if (typeFilter) {
        wheres.push('type = ?');
        params.push(typeFilter);
      }
      const whereSQL = wheres.join(' AND ');

      const total = db.prepare(`SELECT COUNT(*) as c FROM notifications WHERE ${whereSQL}`).get(...params).c;
      const totalPages = Math.ceil(total / limit);
      const items = db.prepare(`SELECT * FROM notifications WHERE ${whereSQL} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

      // 获取该用户所有通知类型（用于下拉筛选）
      const types = db.prepare('SELECT DISTINCT type FROM notifications WHERE user_id = ? ORDER BY type').all(user.id);

      const typeIcons = { submission_status: '📝', new_challenge: '📢', system: 'ℹ️' };

      const rows = items.length ? items.map(n => `
        <div class="notify-item ${n.read ? 'notify-read' : 'notify-unread'}">
          <div class="notify-icon">${typeIcons[n.type] || '🔔'}</div>
          <div class="notify-body">
            <div class="notify-title">${this._escape(n.title)}</div>
            ${n.message ? `<div class="notify-msg">${this._escape(n.message)}</div>` : ''}
            <div class="notify-meta">
              <span class="notify-time">${n.created_at}</span>
              ${!n.read ? `<form method="POST" action="/notifications/${n.id}/read" style="display:inline"><button type="submit" class="btn small">${t('notifications.mark_read')}</button></form>` : ''}
              ${n.link ? `<a href="${this._escape(n.link)}" class="btn small">${t('notifications.view')}</a>` : ''}
            </div>
          </div>
        </div>`).join('') : `<p style="color:var(--text-muted)">${t('notifications.empty')}</p>`;

      // 分页链接保留搜索/筛选参数
      const pageParams = [];
      if (q) pageParams.push('q=' + encodeURIComponent(q));
      if (typeFilter) pageParams.push('type=' + encodeURIComponent(typeFilter));
      const baseUrl = '/notifications' + (pageParams.length ? '?' + pageParams.join('&') + '&' : '?');
      const pagination = totalPages > 1 ? `<div class="pagination">${Array.from({length: totalPages}, (_, i) => `<a href="${baseUrl}page=${i + 1}" class="btn small ${i + 1 === page ? 'active' : ''}">${i + 1}</a>`).join('')}</div>` : '';

      const activeFilter = q || typeFilter;

      res.send(render(t('notifications.title') + ' · ' + t('home.title'), user, `
        <div class="section">
          <h1>🔔 ${t('notifications.title')}</h1>

          <div class="notify-tools" style="display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center">
            <form method="GET" action="/notifications" style="display:flex;gap:0.5rem;flex-wrap:wrap;flex:1">
              <input type="search" name="q" placeholder="${t('notifications.search_placeholder')}" value="${this._escape(q)}"
                style="flex:1;min-width:180px;padding:0.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:0.9rem">
              <select name="type"
                style="padding:0.5rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:0.9rem">
                <option value="">${t('notifications.filter_all')}</option>
                ${types.map(tp => `<option value="${this._escape(tp.type)}" ${tp.type === typeFilter ? 'selected' : ''}>${typeIcons[tp.type] || '🔔'} ${this._escape(tp.type)}</option>`).join('')}
              </select>
              <button type="submit" class="btn">🔍</button>
              ${activeFilter ? `<a href="/notifications" class="btn" style="background:var(--text-muted)">✕ ${t('notifications.clear')}</a>` : ''}
            </form>
            ${!activeFilter && items.length ? `<form method="POST" action="/notifications/read-all" style="display:inline"><button type="submit" class="btn">${t('notifications.read_all')}</button></form>` : ''}
          </div>

          ${activeFilter ? `<p style="color:var(--text-muted);margin-bottom:1rem;font-size:0.85rem">${t('notifications.result_count').replace('{count}', total)}</p>` : ''}
          ${rows}
          ${pagination}
        </div>`));
    });

    // ── 标记单个通知已读 ──
    app.post('/notifications/:id/read', auth.member, (req, res) => {
      db.prepare('UPDATE notifications SET read = ? WHERE id = ? AND user_id = ?').run(1, req.params.id, req.session.user.id);
      const ref = req.get('Referer') || '/notifications';
      res.redirect(ref);
    });

    // ── 全部标记已读 ──
    app.post('/notifications/read-all', auth.member, (req, res) => {
      db.prepare('UPDATE notifications SET read = ? WHERE user_id = ?').run(1, req.session.user.id);
      res.redirect('/notifications');
    });
  },

  _escape(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

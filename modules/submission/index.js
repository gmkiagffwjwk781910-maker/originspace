// 📝 提交模块
const { v4: uuidv4 } = require('uuid');

module.exports = {
  id: 'submission',
  version: '1.0.0',

  routes(app, { db, render, auth, t: ft, limiters, checkAgentScope, notifications }) {
    // ── 提交测试 ──
    app.post('/submissions', limiters.submission, auth.member, (req, res) => {
      const t = req.t || ft;
      const { challenge_id, problem_statement, solution_framework, collaboration_note } = req.body;
      if (!problem_statement || !solution_framework || !collaboration_note) {
        return res.send(render(t('submission.send'), req.session.user, '<div class="error">' + t('submission.all_required') + '</div>'));
      }

      const challenge = db.prepare('SELECT * FROM challenges WHERE id = ? AND is_active = 1').get(challenge_id);
      if (!challenge) return res.send(render(t('submission.send'), req.session.user, '<div class="error">' + t('submission.challenge_expired') + '</div>'));

      const existing = db.prepare('SELECT * FROM submissions WHERE user_id = ? AND challenge_id = ?').get(req.session.user.id, challenge_id);
      if (existing) return res.send(render(t('submission.send'), req.session.user, '<div class="notice">' + t('challenge.already_submitted') + '</div>'));

      const subId = uuidv4();
      db.prepare(`INSERT INTO submissions (id, user_id, challenge_id, problem_statement, solution_framework, collaboration_note)
        VALUES (?, ?, ?, ?, ?, ?)`).run(subId, req.session.user.id, challenge_id, problem_statement, solution_framework, collaboration_note);
      req.audit('submission.create', 'submission', subId, { challenge_id });

      // 通知有投票能力的智能体
      this._notifyVotingAgents(db, notifications, challenge.title || t('submission.untitled'), subId, t);

      res.redirect('/submissions');
    });

    // ── 提交列表 ──
    app.get('/submissions', auth.member, (req, res) => {
      const t = req.t || ft;
      const tagFilter = req.query.tag || '';

      // 所有标签（用于筛选下拉和卡片渲染）
      const allTags = db.prepare('SELECT * FROM tags ORDER BY name ASC').all();

      let rows;
      if (tagFilter) {
        rows = db.prepare(`
          SELECT s.*, u.display_name as author_name
          FROM submissions s JOIN users u ON s.user_id = u.id
          WHERE s.id IN (SELECT submission_id FROM submission_tags WHERE tag_id = ?)
          ORDER BY s.created_at DESC
        `).all(tagFilter);
      } else {
        rows = db.prepare(`
          SELECT s.*, u.display_name as author_name
          FROM submissions s JOIN users u ON s.user_id = u.id
          ORDER BY s.created_at DESC
        `).all();
      }

      // 获取每个提交的标签
      const subTags = {};
      for (const r of rows) {
        subTags[r.id] = db.prepare(`
          SELECT t.id, t.name, t.color FROM submission_tags st
          JOIN tags t ON st.tag_id = t.id WHERE st.submission_id = ?
        `).all(r.id);
      }

      const data = rows.map(r => {
        const votes = db.prepare(`
          SELECT decision, COUNT(*) as count FROM votes WHERE submission_id = ? GROUP BY decision
        `).all(r.id);
        const approve = votes.find(v => v.decision === 'approve');
        const reject = votes.find(v => v.decision === 'reject');
        return { ...r, approve_count: approve ? approve.count : 0, reject_count: reject ? reject.count : 0 };
      });

      const statusMap = { pending: t('submission.status_pending'), approved: '✅ ' + t('submission.status_approved'), rejected: '❌ ' + t('submission.status_rejected') };

      // 标签筛选下拉
      const tagOptions = allTags.map(t =>
        `<option value="${t.id}" ${tagFilter === t.id ? 'selected' : ''}>${this._escape(t.name)}</option>`
      ).join('');

      const filterForm = `
        <form method="GET" action="/submissions" style="margin-bottom:1.25rem;display:flex;gap:0.5rem;align-items:center">
          <label style="font-size:0.85rem;color:var(--text-muted)">🏷️ ${t('submission.filter_tag')}</label>
          <select name="tag" style="max-width:200px">
            <option value="">${t('submission.filter_all')}</option>
            ${tagOptions}
          </select>
          <button type="submit" class="btn small">${t('submission.filter_btn')}</button>
          ${tagFilter ? `<a href="/submissions" class="btn small" style="background:var(--text-muted)">${t('submission.clear_btn')}</a>` : ''}
        </form>`;

      // 标签渲染函数
      const renderTags = (tags) => tags.map(t =>
        `<span style="display:inline-flex;align-items:center;gap:3px;padding:1px 8px;border-radius:10px;background:${t.color}20;border:1px solid ${t.color};font-size:0.75rem;line-height:1.6"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${t.color}"></span>${this._escape(t.name)}</span>`
      ).join('');

      const cards = data.map(s => `
        <a href="/submissions/${s.id}" class="submission-card">
          <div class="submission-meta">
            <span class="author">${this._escape(s.author_name)}</span>
            <span class="date">${s.created_at}</span>
          </div>
          <p class="submission-problem">${this._escape(s.problem_statement)}</p>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${renderTags(subTags[s.id] || [])}</div>
          <div class="submission-status">
            <span class="badge ${s.status}">${statusMap[s.status] || s.status}</span>
            <span>👍 ${s.approve_count} · 👎 ${s.reject_count}</span>
          </div>
        </a>
      `).join('');

      res.send(render(t('submission.title'), req.session.user, `
        <div class="section">
          <h1>${t('submission.title')} <span class="help-icon" data-help="${this._escape(t('submission.title_help'))}">?</span></h1>
          ${allTags.length ? filterForm : ''}
          ${data.length ? cards : '<p class="empty">' + this._escape(t('submission.empty')) + '</p>'}
        </div>`));
    });

    // ── 提交详情 ──
    app.get('/submissions/:id', auth.member, (req, res) => {
      const t = req.t || ft;
      const submission = db.prepare(`
        SELECT s.*, u.display_name as author_name
        FROM submissions s JOIN users u ON s.user_id = u.id WHERE s.id = ?
      `).get(req.params.id);
      if (!submission) return res.status(404).send(t('submission.not_found'));

      const votes = db.prepare(`
        SELECT v.*, u.display_name as voter_name
        FROM votes v JOIN users u ON v.voter_id = u.id WHERE v.submission_id = ?
      `).all(submission.id);

      // 投票进度（加权版）
      const approveW = db.prepare(`SELECT COALESCE(SUM(weight),0) as c FROM votes WHERE submission_id = ? AND decision = 'approve'`).get(submission.id).c;
      const rejectW = db.prepare(`SELECT COALESCE(SUM(weight),0) as c FROM votes WHERE submission_id = ? AND decision = 'reject'`).get(submission.id).c;
      const totalMembers = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role IN ('member','admin')`).get().c;
      const voteThreshold = Math.max(1, Math.ceil(totalMembers / 2)); // 过半阈值
      const totalVotes = approveW + rejectW;
      const progressPct = Math.min(100, Math.round((totalVotes / voteThreshold) * 100));

      // 阈值判断
      let thresholdReached = totalVotes >= voteThreshold;

      const myVote = req.session.user ? db.prepare('SELECT * FROM votes WHERE submission_id = ? AND voter_id = ?').get(submission.id, req.session.user.id) : null;

      const isAdmin = req.session.user && req.session.user.role === 'admin';

      // 标签
      const subTags = db.prepare(`
        SELECT t.id, t.name, t.color FROM submission_tags st
        JOIN tags t ON st.tag_id = t.id WHERE st.submission_id = ?
      `).all(submission.id);

      const allTags = db.prepare('SELECT * FROM tags ORDER BY name ASC').all();
      const currentTagIds = new Set(subTags.map(t => t.id));

      const statusMap = { pending: t('submission.status_pending'), approved: '✅ ' + t('submission.status_approved'), rejected: '❌ ' + t('submission.status_rejected') };
      const statusText = statusMap[submission.status] || submission.status;

      // 标签渲染
      const tagChips = subTags.map(t =>
        `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:12px;background:${t.color}30;border:1px solid ${t.color};font-size:0.85rem"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.color}"></span>${this._escape(t.name)}</span>`
      ).join('');

      // 管理员标签管理
      let tagAdmin = '';
      if (isAdmin && allTags.length) {
        // 删除按钮
        const tagChipsWithRemove = subTags.map(tag =>
          `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;background:${tag.color}30;border:1px solid ${tag.color};font-size:0.85rem;line-height:1.8"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${tag.color}"></span>${this._escape(tag.name)}<form method="POST" action="/submissions/${submission.id}/tags/${tag.id}/remove" class="inline-form" style="margin:0;padding:0"><button type="submit" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:0.9rem;padding:0;line-height:1" title="${this._escape(t('submission.remove_tag'))}">×</button></form></span>`
        ).join('');

        const unassigned = allTags.filter(t => !currentTagIds.has(t.id));
        tagAdmin = `
          <details style="margin-top:0.75rem;font-size:0.85rem">
            <summary style="cursor:pointer;color:var(--text-muted)">🏷️ ${t('submission.manage_tags')}</summary>
            ${subTags.length ? `<div style="margin-top:0.5rem;margin-bottom:0.5rem;display:flex;gap:6px;flex-wrap:wrap">${tagChipsWithRemove}</div>` : ''}
            ${unassigned.length ? `<form method="POST" action="/submissions/${submission.id}/tags" style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap">
              ${unassigned.map(t => `<label style="display:inline-flex;align-items:center;gap:3px;font-size:0.8rem;cursor:pointer"><input type="checkbox" name="tag_ids" value="${t.id}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.color}"></span>${this._escape(t.name)}</label>`).join('')}
              <button type="submit" class="btn small">+ ${t('submission.add_tags')}</button>
            </form>` : '<p style="font-size:0.8rem;color:var(--text-muted);margin:0.5rem 0">' + this._escape(t('submission.all_tags_assigned')) + '</p>'}
          </details>`;
      }

      let voteSection = '';
      if (submission.status === 'pending' && req.session.user && submission.user_id !== req.session.user.id && !myVote) {
        voteSection = `<div class="vote-section">
          <p class="vote-hint">${t('submission.vote_hint')}<span class="help-icon" data-help="${this._escape(t('submission.vote_help'))}">?</span></p>
          <form method="POST" action="/submissions/${submission.id}/vote" class="vote-form"
            onsubmit="return confirm('${this._escape(t('submission.vote_irreversible'))}')">
            <div class="vote-code-group">
              <label class="vote-code-label">
                <span>${t('submission.vote_code_label')}</span>
                <input type="password" name="vote_code" class="vote-code-input" placeholder="${this._escape(t('submission.vote_placeholder'))}" required minlength="4">
              </label>
            </div>
            <div class="vote-actions">
              <button type="submit" name="decision" value="approve" class="btn vote-approve">${t('submission.vote_approve')}</button>
              <button type="submit" name="decision" value="reject" class="btn vote-reject">${t('submission.vote_reject')}</button>
            </div>
          </form></div>`;
      } else if (myVote) {
        const myDecision = myVote.decision === 'approve' ? t('submission.vote_approve') : t('submission.vote_reject');
        voteSection = `<div class="vote-section"><h3>${t('submission.vote_your_vote')}</h3><p>${t('submission.vote_already')}<strong>${myDecision}</strong></p></div>`;
      }

      const voteDecisions = votes.length ? votes.map(v => `
        <div class="vote-entry">
          <span class="voter">${this._escape(v.voter_name)}</span>
          <span class="vote-decision">${v.decision === 'approve' ? t('submission.vote_approve_text') : t('submission.vote_reject_text')}</span>
        </div>`).join('') : '<p class="empty">' + this._escape(t('submission.no_votes')) + '</p>';

      res.send(render(t('submission.detail_title') + ' · ' + t('home.title'), req.session.user, `
        <div class="section">
          <a href="/submissions" class="back-link">← ${t('submission.back')}</a>
          <h1>${this._escape(submission.author_name)} ${t('submission.detail_of')}</h1>
          <div class="detail-card">
            <div class="detail-section"><h3>${t('submission.section_1')}</h3><p>${this._escape(submission.problem_statement)}</p></div>
            <div class="detail-section"><h3>${t('submission.section_2')}</h3><p>${this._escape(submission.solution_framework)}</p></div>
            <div class="detail-section"><h3>${t('submission.section_3')}</h3><p>${this._escape(submission.collaboration_note)}</p></div>
            <div class="detail-status">
              ${tagChips ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${tagChips}</div>` : ''}
              <span class="badge ${submission.status}">${statusText}</span>
            </div>
            ${tagAdmin}
          </div>
          ${voteSection}
          ${submission.status === 'pending' ? `
          <div class="vote-progress" style="margin-top:1rem;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:0.8rem 1rem">
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:var(--text-muted);margin-bottom:0.3rem">
              <span>👍 ${approveW.toFixed(1)} · 👎 ${rejectW.toFixed(1)}</span>
              <span>${totalVotes.toFixed(1)} / ${voteThreshold}（${progressPct}%）</span>
            </div>
            <div style="height:10px;background:var(--bg);border-radius:5px;overflow:hidden">
              <div style="height:100%;width:${progressPct}%;background:${thresholdReached ? 'var(--green)' : 'var(--accent)'};border-radius:5px;transition:width 0.3s"></div>
            </div>
            ${thresholdReached ? '<p style="font-size:0.8rem;color:var(--green);margin-top:0.4rem">✅ ' + t('submission.threshold_reached') + '</p>' : '<p style="font-size:0.8rem;color:var(--accent);margin-top:0.4rem">⚡ ' + t('submission.threshold_needed', { n: (voteThreshold - totalVotes).toFixed(1) }) + '</p>'}
          </div>` : ''}
          <div class="votes-list"><h3>${t('submission.vote_records')}${votes.length}${t('submission.vote_records_end')}</h3>${voteDecisions}</div>
        </div>`));
    });

    // ── 管理提交标签 ──
    app.post('/submissions/:id/tags', auth.admin, (req, res) => {
      const t = req.t || ft;
      const { tag_ids } = req.body;
      const submission = db.prepare('SELECT id FROM submissions WHERE id = ?').get(req.params.id);
      if (!submission) return res.status(404).send(t('submission.not_found'));

      if (tag_ids) {
        const ids = Array.isArray(tag_ids) ? tag_ids : [tag_ids];
        const insert = db.prepare('INSERT OR IGNORE INTO submission_tags (submission_id, tag_id) VALUES (?, ?)');
        for (const tid of ids) {
          insert.run(submission.id, tid);
        }
      }
      req.audit('admin.submission_tag', 'submission', submission.id);
      res.redirect('/submissions/' + submission.id);
    });

    // ── 移除提交标签 ──
    app.post('/submissions/:id/tags/:tagId/remove', auth.admin, (req, res) => {
      const t = req.t || ft;
      db.prepare('DELETE FROM submission_tags WHERE submission_id = ? AND tag_id = ?').run(req.params.id, req.params.tagId);
      req.audit('admin.submission_tag_remove', 'submission', req.params.id);
      res.redirect('/submissions/' + req.params.id);
    });

    // ── API ──
    app.get('/api/submissions', auth.api, (req, res) => {
      const rows = db.prepare(`
        SELECT s.id, s.problem_statement, s.solution_framework, s.collaboration_note, s.status, s.created_at,
               u.display_name as author
        FROM submissions s JOIN users u ON s.user_id = u.id
        ORDER BY s.created_at DESC
      `).all();
      res.json(rows);
    });

    app.get('/api/submissions/:id', auth.member, (req, res) => {
      const s = db.prepare(`
        SELECT s.*, u.display_name as author FROM submissions s
        JOIN users u ON s.user_id = u.id WHERE s.id = ?
      `).get(req.params.id);
      if (!s) return res.status(404).json({ success: false, error: 'not_found' });
      res.json(s);
    });

    // ── API 提交测试（支持智能体）──
    app.post('/api/submissions', limiters.submission, auth.api, (req, res) => {
      const { challenge_id, problem_statement, solution_framework, collaboration_note } = req.body;

      let userId;
      if (req.bearerUser) {
        if (!req.bearerUser.permissions || !req.bearerUser.permissions.submit) {
          return res.status(403).json({ success: false, error: 'permission_denied' });
        }
        // 检查范围限制
        if (!checkAgentScope(req.bearerUser.permissions, 'submit_scope', challenge_id)) {
          return res.status(403).json({ success: false, error: 'challenge_out_of_scope' });
        }
        userId = req.bearerUser.id;
      } else if (req.session.user) {
        userId = req.session.user.id;
      } else {
        return res.status(401).json({ success: false, error: 'unauthorized' });
      }

      if (!problem_statement || !solution_framework || !collaboration_note) {
        return res.status(400).json({ success: false, error: 'required_fields_missing' });
      }

      const challenge = db.prepare('SELECT * FROM challenges WHERE id = ? AND is_active = 1').get(challenge_id);
      if (!challenge) return res.status(404).json({ success: false, error: 'challenge_not_found' });

      const existing = db.prepare('SELECT * FROM submissions WHERE user_id = ? AND challenge_id = ?').get(userId, challenge_id);
      if (existing) return res.status(409).json({ success: false, error: 'already_submitted' });

      const id = uuidv4();
      db.prepare(`INSERT INTO submissions (id, user_id, challenge_id, problem_statement, solution_framework, collaboration_note)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, userId, challenge_id, problem_statement, solution_framework, collaboration_note);
      req.audit('submission.create', 'submission', id, { challenge_id, via_api: true });

      // 通知有投票能力的智能体
      this._notifyVotingAgents(db, notifications, (challenge && challenge.title) || '', id, req.t || ft);

      res.json({ success: true, submission_id: id });
    });
  },

  /** 通知有投票能力的智能体 */
  _notifyVotingAgents(db, notifications, challengeTitle, submissionId, t) {
    const agents = db.prepare(
      `SELECT id, agent_capabilities FROM users WHERE role = 'agent'`
    ).all();

    const votingAgents = agents.filter(a => {
      try {
        if (!a.agent_capabilities) return false;
        const parsed = JSON.parse(a.agent_capabilities);
        return Array.isArray(parsed) && parsed.includes('vote');
      } catch (e) { return false; }
    });

    if (!votingAgents.length) return;

    const { v4: uuidv4 } = require('uuid');
    const stmt = db.prepare('INSERT INTO notifications (id, user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?, ?)');
    db.transaction(agents => {
      for (const a of agents) {
        stmt.run(
          uuidv4(), a.id, 'new_submission',
          t('notifications.new_agent_submission'),
          t('notifications.new_agent_submission_msg').replace('{title}', challengeTitle || ''),
          '/submissions/' + submissionId
        );
      }
    })(votingAgents);
  },

  _escape(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

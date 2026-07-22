// 📬 反馈模块 — 低门槛信息通道
module.exports = {
  id: 'feedback',
  version: '1.0.0',

  routes(app, { db, render, auth, t: ft }) {

    // ── 提交反馈（无需登录） ──
    app.get('/feedback', (req, res) => {
      const t = req.t || ft;
      const user = req.session.user || null;
      const success = req.query.ok === '1';

      const html = `
        <div class="card" style="max-width:600px;margin:2rem auto">
          <h2>📬 ${t('feedback.title')}</h2>
          <p style="color:var(--text-muted)">${t('feedback.desc')}</p>
          ${success ? '<p style="color:var(--green);font-weight:bold">✅ ' + t('feedback.success') + '</p>' : ''}
          <form method="POST" action="/feedback">
            <div style="margin:0.75rem 0">
              <label>${t('feedback.name')} <span style="color:var(--text-muted);font-size:0.8rem">(${t('feedback.optional')})</span></label>
              <input type="text" name="name" placeholder="Your name / nickname" style="width:100%;margin-top:0.3rem">
            </div>
            <div style="margin:0.75rem 0">
              <label>${t('feedback.contact')} <span style="color:var(--text-muted);font-size:0.8rem">(${t('feedback.optional')} — email / social / etc)</span></label>
              <input type="text" name="contact" placeholder="@username / email / ..." style="width:100%;margin-top:0.3rem">
            </div>
            <div style="margin:0.75rem 0">
              <label>${t('feedback.message')} <span style="color:red">*</span></label>
              <textarea name="message" rows="5" required style="width:100%;margin-top:0.3rem" placeholder="${t('feedback.placeholder')}"></textarea>
            </div>
            <div style="margin:1rem 0 0.5rem">
              <button type="submit" class="btn">${t('feedback.submit')}</button>
            </div>
          </form>
        </div>
        <div class="card" style="max-width:600px;margin:1rem auto">
          <h3>🐛 ${t('feedback.bug_title')}</h3>
          <p style="color:var(--text-muted)">${t('feedback.bug_desc')}</p>
          <a href="https://github.com/gmkiagffwjwk781910-maker/originspace/issues/new" target="_blank" class="btn btn-outline small">GitHub Issues →</a>
        </div>`;

      res.send(render(t('feedback.title'), user, html));
    });

    // ── POST 处理 ──
    app.post('/feedback', (req, res) => {
      const name = (req.body.name || '').trim();
      const contact = (req.body.contact || '').trim();
      const message = (req.body.message || '').trim();
      const user = req.session.user || null;

      if (!message) {
        return res.redirect('/feedback?error=empty');
      }

      db.prepare(`INSERT INTO feedback (name, email, message, page, user_id) VALUES (?, ?, ?, ?, ?)`).run(
        name || 'anonymous',
        contact || '',
        message,
        req.headers['referer'] || '',
        user ? user.id : null
      );

      res.redirect('/feedback?ok=1');
    });

    // ── 管理员查看反馈 ──
    app.get('/admin/feedback', (req, res) => {
      const t = req.t || ft;
      const user = req.session.user || null;
      if (!user || user.role !== 'admin') return res.status(403).send('Forbidden');

      const items = db.prepare(`SELECT * FROM feedback ORDER BY read ASC, created_at DESC LIMIT 100`).all();

      const rows = items.map(f => `
        <div class="card" style="margin:0.5rem 0;${f.read ? 'opacity:0.6' : ''}">
          <div style="display:flex;justify-content:space-between">
            <strong>${this._escape(f.name)}</strong>
            <span style="font-size:0.8rem;color:var(--text-muted)">${f.created_at}</span>
          </div>
          ${f.email ? '<div style="font-size:0.8rem;color:var(--text-muted)">📧 ' + this._escape(f.email) + '</div>' : ''}
          <div style="margin-top:0.4rem;white-space:pre-wrap">${this._escape(f.message)}</div>
          <div style="margin-top:0.3rem;display:flex;gap:0.5rem">
            ${!f.read ? `<a href="/admin/feedback/read/${f.id}" class="btn small btn-outline">✅ ${t('feedback.mark_read')}</a>` : ''}
          </div>
        </div>`).join('');

      const html = `
        <h2>📬 ${t('feedback.admin_title')}</h2>
        <p style="color:var(--text-muted)">${items.filter(f => !f.read).length} ${t('feedback.unread')}</p>
        ${rows || '<p style="color:var(--text-muted)">暂无反馈</p>'}`;

      res.send(render(t('feedback.admin_title'), user, html));
    });

    // ── 标记已读 ──
    app.get('/admin/feedback/read/:id', (req, res) => {
      const user = req.session.user || null;
      if (!user || user.role !== 'admin') return res.status(403).send('Forbidden');
      db.prepare(`UPDATE feedback SET read = 1 WHERE id = ?`).run(req.params.id);
      res.redirect('/admin/feedback');
    });
  }
};

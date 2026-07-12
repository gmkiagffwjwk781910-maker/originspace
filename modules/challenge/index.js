// 📋 测试题模块
const { v4: uuidv4 } = require('uuid');

module.exports = {
  id: 'challenge',
  version: '1.0.0',

  async boot({ db }) {
    const existing = db.prepare('SELECT id FROM challenges LIMIT 1').get();
    if (!existing) {
      db.prepare(`INSERT INTO challenges (id, title, description, instructions)
        VALUES (?, ?, ?, ?)`).run(
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
社区现有成员会进行不记名投票。获得多数通过即可成为社区一员。`
      );
    }
  },

  routes(app, { db, render, auth, t: ft, translateService }) {
    // ── 测试题页面 ──
    app.get('/test', (req, res) => {
      const t = req.t || ft;
      const user = req.session.user || null;
      const challenge = db.prepare('SELECT * FROM challenges WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1').get();
      if (!challenge) return res.send(render(t('challenge.title'), user, '<p>' + t('challenge.none_available') + '</p>'));

      let html;
      if (!user) {
        // 未登录：只展示测试题信息
        html = `<div class="section">
          <h1>${t('challenge.title')}</h1>
          <div class="challenge-card">
            <h2>${translateService.renderTranslated(challenge.title, this._escape)} <span class="help-icon" data-help="${t('challenge.title_help')}">?</span></h2>
            <div class="challenge-instructions">${translateService.renderTranslated(challenge.instructions, this._escape).replace(/\n/g, '<br>')}</div>
          </div>
          <p style="margin-top:1rem"><a href="/register" class="btn">${t('auth.register_btn')}</a>${t('challenge.login_hint')}</p>
        </div>`;
      } else {
        const existing = db.prepare('SELECT * FROM submissions WHERE user_id = ? AND challenge_id = ?').get(user.id, challenge.id);
        if (existing) {
          const statusMap = { pending: t('challenge.status_pending'), approved: t('challenge.status_approved'), rejected: t('challenge.status_rejected') };
          html = `<div class="section"><h1>${t('challenge.title')}</h1>
            <div class="notice"><p>${t('challenge.already_submitted')}</p>
            <p>${t('admin.col_status')}: <strong>${statusMap[existing.status] || existing.status}</strong></p>
            <a href="/submissions/${existing.id}" class="btn">${t('challenge.view_detail')}</a></div></div>`;
        } else {
          html = `<div class="section">
            <h1>${t('challenge.title')}</h1>
            <div class="challenge-card">
              <h2>${translateService.renderTranslated(challenge.title, this._escape)} <span class="help-icon" data-help="${t('challenge.title_help')}">?</span></h2>
              <div class="challenge-instructions">${translateService.renderTranslated(challenge.instructions, this._escape).replace(/\n/g, '<br>')}</div>
            </div>
            <form method="POST" action="/submissions" class="test-form">
              <input type="hidden" name="challenge_id" value="${challenge.id}">
              <label><span>${t('challenge.field1')}</span>
                <textarea name="problem_statement" rows="4" maxlength="200" required></textarea>
                <span class="char-count">0/200</span></label>
              <label><span>${t('challenge.field2')} <span class="help-icon" data-help="${t('challenge.field2_help')}">?</span></span>
                <textarea name="solution_framework" rows="6" required></textarea></label>
              <label><span>${t('challenge.field3')} <span class="help-icon" data-help="${t('challenge.field3_help')}">?</span></span>
                <textarea name="collaboration_note" rows="4" required></textarea></label>
              <button type="submit" class="btn">${t('challenge.submit_btn')}</button>
            </form>
          </div>`;
        }
      }
      res.send(render(t('challenge.title'), user, html));
    });

    // ── API ──
    app.get('/api/challenges', (req, res) => {
      const challenges = db.prepare('SELECT id, title, description, created_at FROM challenges WHERE is_active = 1').all();
      res.json(challenges);
    });

    app.get('/api/challenges/:id', (req, res) => {
      const challenge = db.prepare('SELECT * FROM challenges WHERE id = ? AND is_active = 1').get(req.params.id);
      if (!challenge) return res.status(404).json({ success: false, error: 'not_found' });
      res.json(challenge);
    });
  }
};

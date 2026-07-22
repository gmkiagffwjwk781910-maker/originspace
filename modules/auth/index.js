// 🔐 认证模块
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const mailer = require('./mailer');

module.exports = {
  id: 'auth',
  version: '1.0.0',

  async boot({ db }) {
    // 数据库迁移
    const migrations = [
      { col: 'vote_code_hash', type: "TEXT NOT NULL DEFAULT ''" },
      { col: 'must_change_pass', type: "INTEGER NOT NULL DEFAULT 0" },
      { col: 'email', type: "TEXT NOT NULL DEFAULT ''" },
      { col: 'passcode_changed_at', type: "TEXT DEFAULT (datetime('now'))" },
    ];
    for (const m of migrations) {
      try {
        db.exec(`ALTER TABLE users ADD COLUMN ${m.col} ${m.type}`);
        console.log(`  ↳ 迁移: users 表添加 ${m.col} 列`);
      } catch (e) { /* 列已存在 */ }
    }

    // 第一次启动时创建默认管理员
    const admin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
    if (!admin) {
      const dummyHash = crypto.createHash('sha256').update('origin-bootstrap').digest('hex');
      db.prepare(`INSERT INTO users (id, username, passcode_hash, vote_code_hash, display_name, role)
        VALUES (?, ?, ?, ?, ?, 'admin')`).run(uuidv4(), 'origin', dummyHash, dummyHash, '原点');
    }
  },

  routes(app, { db, render, auth, t: ft, generateUserCode }) {
    // ── 合并登录/注册页 ──
    function _combinedPage(err, t, render, newKey) {
      return render(t('auth.login_title') + ' · ' + t('home.title'), null,
        `<div class="form-card">
          <h1>🔑 ${t('auth.login_title')}</h1>
          ${err ? `<div class="error">${err}</div>` : ''}
          ${newKey ? `<div class="newkey-banner"><h3>🔑 ${t('profile.newkey_title')}</h3><p>${t('profile.newkey_desc')}</p><code id="api-key-display" style="display:block;text-align:center;font-size:1.2rem;padding:0.8rem;background:var(--bg);border:2px dashed var(--accent);border-radius:6px;margin:0.8rem 0;word-break:break-all;user-select:all">${newKey}</code>
          <button onclick="copyApiKey()" id="copy-key-btn" style="display:block;margin:0.5rem auto 0;padding:0.5rem 1.5rem;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.95rem">📋 ${t('auth.copy_key')}</button>
          <script>
          function copyApiKey(){const k=document.getElementById('api-key-display');const t=k.textContent;navigator.clipboard.writeText(t).then(()=>{const b=document.getElementById('copy-key-btn');b.textContent='✅ '+${JSON.stringify(t('auth.copied'))};setTimeout(()=>{b.textContent='📋 '+${JSON.stringify(t('auth.copy_key'))}},2500)}).catch(()=>{const s=window.getSelection();const r=document.createRange();r.selectNodeContents(k);s.removeAllRanges();s.addRange(r)})}
          </script><p style="color:#d97706;font-weight:bold;text-align:center">⚠️ ${t('profile.newkey_warning')}</p><p style="text-align:center;margin-top:0.5rem"><a href="/" class="btn">${t('nav.home')}</a></p></div><hr style="margin:1.5rem 0;border-color:var(--border)">` : ''}

          <form method="POST">
            <label>${t('auth.api_key_label')} <input type="text" name="api_key" placeholder="oc_..." style="font-family:monospace"></label>
            <button type="submit" class="btn">${t('auth.login_btn')}</button>
          </form>

          <div class="form-divider"><span>${t('auth.or_register')}</span></div>

          <form method="POST">
            <input type="hidden" name="_register" value="1">
            <label>${t('auth.username')} <input type="text" name="username" required oninput="checkUsername(this.value)"> <span id="username-status" class="form-hint" style="display:none;margin-left:0.3rem"></span></label>
            <label>${t('auth.display_name')} <input type="text" name="display_name" required></label>
            <label>${t('auth.email')} <input type="email" name="email" required placeholder="${t('auth.email_placeholder')}"></label>
            <p class="form-hint" style="margin-bottom:0.5rem">${t('auth.register_hint_api')}</p>
            <button type="submit" class="btn">${t('auth.register_btn')}</button>
          </form>

        </div>`);
    }

    app.get('/login', (req, res) => {
      const t = req.t || ft;
      if (req.session.user) return res.redirect('/');
      const newKey = req.session._newApiKey || null;
      if (newKey) delete req.session._newApiKey;
      res.send(_combinedPage(null, t, render, newKey));
    });

    app.get('/register', (req, res) => {
      const t = req.t || ft;
      if (req.session.user) return res.redirect('/');
      const newKey = req.session._newApiKey || null;
      if (newKey) delete req.session._newApiKey;
      res.send(_combinedPage(null, t, render, newKey));
    });

    app.post('/login', (req, res) => {
      const t = req.t || ft;
      const { api_key, _register } = req.body;

      // ── 注册流程 ──
      if (_register) {
        const { username, display_name, email } = req.body;
        if (!username || !display_name || !email) {
          return res.send(_combinedPage(t('auth.all_required'), t, render));
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.send(_combinedPage(t('auth.invalid_email'), t, render));
        }
        try {
          const rawKey = 'oc_' + crypto.randomBytes(32).toString('hex');
          const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
          const code = generateUserCode();
          const userId = uuidv4();
          const dummyHash = crypto.createHash('sha256').update(userId).digest('hex');
          db.prepare(`INSERT INTO users (id, username, passcode_hash, vote_code_hash, display_name, email, role, user_code, agent_key)
            VALUES (?, ?, ?, ?, ?, ?, 'applicant', ?, ?)`).run(userId, username, dummyHash, dummyHash, display_name, email, code, keyHash);
          req.session._newApiKey = rawKey;
          req.audit('auth.register', 'user', userId);
          const baseUrl = process.env.PUBLIC_URL || req.protocol + '://' + req.get('host');
          mailer.sendApiKeyEmail(email, display_name || username, rawKey, baseUrl + '/login').catch(e => {
            console.error('❌ 发送 API Key 邮件失败:', e.message);
          });
          return res.redirect('/login?newkey=1');
        } catch (e) {
          const msg = e.message.includes('UNIQUE') ? t('auth.username_taken') : t('auth.register_fail');
          return res.send(_combinedPage(msg, t, render));
        }
      }

      // ── API Key 登录 ──
      if (api_key) {
        const keyHash = crypto.createHash('sha256').update(api_key).digest('hex');
        const user = db.prepare('SELECT * FROM users WHERE agent_key = ?').get(keyHash);
        if (!user) return res.send(_combinedPage(t('auth.login_fail'), t, render));
        req.session.user = {
          id: user.id, username: user.username,
          display_name: user.display_name, role: user.role
        };
        req.session._createdAt = Date.now();
        req.audit('auth.login', 'user', user.id);
        return res.redirect('/');
      }

      return res.send(_combinedPage(t('auth.login_fail'), t, render));
    });

    // ── 注册页（GET）也使用合并页 ──
    app.get('/register', (req, res) => {
      const t = req.t || ft;
      if (req.session.user) return res.redirect('/');
      res.send(_combinedPage(null, t, render));
    });

    // ── 检查用户名重复 ──
    app.get('/api/check-username', (req, res) => {
      const q = (req.query.q || '').trim();
      if (!q) return res.json({ available: false });
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(q);
      res.json({ available: !existing, username: q });
    });

    // ── 退出 ──
    app.get('/logout', (req, res) => {
      req.session.destroy(() => res.redirect('/'));
    });

    // ── 获取当前用户信息（AI-First API）──
    app.get('/api/me', auth.member, (req, res) => {
      const user = db.prepare('SELECT id, username, display_name, email, role FROM users WHERE id = ?').get(req.session.user.id);
      res.json({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        role: user.role
      });
    });
  },

  _escape(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
};

// ⚪ 原点社区 · 内核
// 只做三件事：建立服务器 · 连接数据库 · 加载模块
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const Database = require('better-sqlite3');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

// ── i18n ──
const _defaultLang = process.env.DEFAULT_LANG || 'zh';
const _supportedLangs = ['zh', 'en'];
const _languages = {};
const _langDir = path.join(__dirname, '..', 'languages');

// 加载语言文件
for (const lang of _supportedLangs) {
  const filePath = path.join(_langDir, lang + '.json');
  if (fs.existsSync(filePath)) {
    try {
      _languages[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error(`  ⚠️  Language file ${lang}.json parse error:`, e.message);
    }
  }
}

// 点号标记查找
function _get(obj, key) {
  return key.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : undefined, obj);
}

// 翻译函数
function translate(key, lang, ctx) {
  const langData = _languages[lang] || _languages[_defaultLang];
  let val = _get(langData, key);
  if (val === undefined && lang !== _defaultLang) {
    val = _get(_languages[_defaultLang], key);
  }
  if (val === undefined) return key;
  if (ctx && typeof ctx === 'object') {
    for (const [k, v] of Object.entries(ctx)) {
      val = val.replace(`{{${k}}}`, v);
    }
  }
  return val;
}

// 每请求语言缓存（Node 单线程，无竞争问题）
let _requestLang = _defaultLang;
let _requestCsrf = '';
let _unreadCount = 0;

class Kernel {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.app = express();
    this.db = null;
    this.modules = new Map();
    this.config = { port: 3456, secret: 'origin-default-secret' };
  }

  configure(opts) { Object.assign(this.config, opts); return this; }

  async boot() {
    const dataDir = path.join(this.rootDir, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // Database
    this.db = new Database(path.join(dataDir, 'kernel.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // 内核元数据表
    this.db.exec(`CREATE TABLE IF NOT EXISTS _kernel_modules (
      id TEXT PRIMARY KEY, version TEXT, loaded_at TEXT
    )`);

    // 审计日志表
    this.db.exec(`CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_username TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT DEFAULT '{}',
      ip TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    // Schema 迁移
    const migrate = require('./migrate');
    // 预置遗留迁移记录（列已通过旧的 try/catch 存在时跳过）
    const hasLegacyCols = (() => {
      try {
        const col = this.db.prepare("SELECT name FROM pragma_table_info('users') WHERE name = 'email_verified'").get();
        return !!col;
      } catch (e) { return false; }
    })();
    if (hasLegacyCols) {
      try {
        const existing = this.db.prepare("SELECT status FROM _migrations WHERE name = '001-legacy-alters'").get();
        if (!existing) {
          this.db.prepare(`INSERT INTO _migrations (name, description, hash, status, applied_at)
            VALUES ('001-legacy-alters', '历史遗留列变更', 'legacy-premigrated', 'ok', datetime('now'))`).run();
        } else if (existing.status === 'failed') {
          this.db.prepare("UPDATE _migrations SET status = 'ok', error_msg = '', hash = 'legacy-premigrated' WHERE name = '001-legacy-alters'").run();
        }
        console.log('  ↳ 遗留列已存在，迁移 001 标记为已应用');
      } catch (e) {
        console.log('  ↳ 遗留迁移标记跳过（已有记录）');
      }
    }
    migrate.runPending(this.db, console.log);

    // 通知表
    this.db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT DEFAULT '',
      link TEXT DEFAULT '',
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC)`);

    // 标签系统
    this.db.exec(`CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3498db',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS submission_tags (
      submission_id TEXT NOT NULL REFERENCES submissions(id),
      tag_id TEXT NOT NULL REFERENCES tags(id),
      PRIMARY KEY (submission_id, tag_id)
    )`);

    // 为所有用户生成/刷新身份编码（YYMMDD + 2随机字符）
    const allUsers = this.db.prepare('SELECT id, created_at FROM users').all();
    if (allUsers.length) {
      const update = this.db.prepare('UPDATE users SET user_code = ? WHERE id = ?');
      const tx = this.db.transaction(() => {
        for (const u of allUsers) {
          // created_at 格式: YYYY-MM-DD HH:MM:SS → YYMMDD
          const parts = u.created_at.split(' ')[0].split('-');
          const dateStr = parts[0].slice(2) + parts[1] + parts[2];
          update.run(this._generateUserCode(dateStr), u.id);
        }
      });
      tx();
      console.log(`  ↳ 身份编码已刷新（${allUsers.length} 用户）`);
    }

    // Express middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(this.rootDir, 'public')));

    // 安全响应头
    this.app.use((req, res, next) => {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self'");
      next();
    });

    // 信任代理（Cloudflare Tunnel 传过来的 X-Forwarded-Proto）
    this.app.set('trust proxy', 1);

    // Session
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) this.app.set('trust proxy', 1);
    this.app.use(session({
      store: new SQLiteStore({ dir: dataDir, db: 'sessions.db' }),
      secret: this.config.secret,
      resave: false,
      saveUninitialized: true,
      cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
    }));

    // ── 语言中间件（session 之后、路由之前）──
    this.app.use((req, res, next) => {
      let lang = (req.session && req.session.lang) || null;
      if (!lang && req.headers['accept-language']) {
        const acceptLang = req.headers['accept-language'].split(',')[0].split('-')[0];
        if (_supportedLangs.includes(acceptLang)) lang = acceptLang;
      }
      if (!lang || !_supportedLangs.includes(lang)) lang = _defaultLang;
      req.lang = lang;
      req.t = (key, ctx) => {
        let val = translate(key, lang);
        if (ctx && typeof ctx === 'object') {
          for (const [k, v] of Object.entries(ctx)) {
            val = val.replace(`{{${k}}}`, v);
          }
        }
        return val;
      };
      _requestLang = lang;
      next();
    });

    // ── CSRF 令牌生成 + 校验中间件（语言之后、Bearer之后、模块路由之前）──
    this.app.use((req, res, next) => {
      if (!req.session) return next();
      // 生成令牌
      if (!req.session._csrfToken) {
        req.session._csrfToken = crypto.randomBytes(32).toString('hex');
      }
      _requestCsrf = req.session._csrfToken;
      // 未读通知数（nav铃铛用）
      _unreadCount = req.session.user ? this.db.prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0").get(req.session.user.id).c : 0;

      // 仅校验状态变更请求
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        // 带 Bearer Token 的 API 请求豁免（它们有自身的认证防护）
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
          return next();
        }

        const bodyToken = req.body && req.body._csrf;
        const headerToken = req.headers['x-csrf-token'];
        const token = bodyToken || headerToken;

        if (!token || token !== req.session._csrfToken) {
          // JSON API 返回 JSON 错误
          if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(403).json({ success: false, error: 'csrf_token_mismatch' });
          }
          return res.status(403).send('<h1>403 Forbidden</h1><p>CSRF token mismatch. <a href="javascript:history.back()">Go back</a> and try again.</p>');
        }
      }
      next();
    });

    // ── 限流器（敏感端点，仅计数 POST 请求）──
    const _skipGet = (req) => req.method !== 'POST';
    // Agent-aware key: 用 agent_id 替代 IP，多 agent 同 IP 不相互干扰
    const _agentKey = (req) => req.bearerUser ? 'agent:' + req.bearerUser.id : ipKeyGenerator(req.ip);
    const limiters = {
      global: rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 200,
        keyGenerator: _agentKey,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'too_many_requests' }
      }),
      login: rateLimit({
        windowMs: 15 * 60 * 1000, max: 10, skip: _skipGet,
        standardHeaders: true, legacyHeaders: false,
        message: { error: 'too_many_login_attempts' }
      }),
      register: rateLimit({
        windowMs: 60 * 60 * 1000, max: 3, skip: _skipGet,
        standardHeaders: true, legacyHeaders: false,
        message: { error: 'too_many_registration_attempts' }
      }),
      vote: rateLimit({
        windowMs: 15 * 60 * 1000, max: 10, skip: _skipGet,
        keyGenerator: _agentKey,
        standardHeaders: true, legacyHeaders: false,
        message: { error: 'too_many_vote_attempts' }
      }),
      submission: rateLimit({
        windowMs: 15 * 60 * 1000, max: 5, skip: _skipGet,
        keyGenerator: _agentKey,
        standardHeaders: true, legacyHeaders: false,
        message: { error: 'too_many_submissions' }
      }),
      profile: rateLimit({
        windowMs: 15 * 60 * 1000, max: 10, skip: _skipGet,
        standardHeaders: true, legacyHeaders: false,
        message: { error: 'too_many_profile_updates' }
      })
    };
    this._limiters = limiters;
    this.app.use(limiters.global);
    this.app.use('/login', limiters.login);
    this.app.use('/register', limiters.register);
    this.app.use('/profile', limiters.profile);

    // ── 语言切换路由（必须早于模块路由注册）──
    this.app.get('/lang/:code', (req, res) => {
      const code = req.params.code;
      if (_supportedLangs.includes(code) && req.session) {
        req.session.lang = code;
      }
      if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest') {
        return res.json({ ok: true, lang: code });
      }
      res.redirect(req.get('Referer') || '/');
    });

    // ── 审计日志中间件（注入 req.audit，在路由之前）──
    this.app.use((req, res, next) => {
      req.audit = (action, targetType, targetId, detail) => {
        const actor = req.session?.user || req.bearerUser || null;
        try {
          this.db.prepare(
            'INSERT INTO audit_logs (id, actor_id, actor_username, actor_role, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(
            require('uuid').v4(),
            actor?.id || null,
            actor?.username || 'anonymous',
            actor?.role || 'anonymous',
            action,
            targetType || null,
            targetId || null,
            typeof detail === 'object' ? JSON.stringify(detail) : (detail || '{}'),
            req.ip || ''
          );
        } catch (e) {
          console.error('audit log error:', e.message);
        }
      };
      next();
    });

    // ── API 速率限制中间件 ──
    const rateBuckets = new Map();
    const RATE_WINDOW = 10 * 1000;   // 10 秒窗口
    const RATE_MAX = 30;             // 每窗口最多 30 次
    setInterval(() => {
      const cutoff = Date.now() - RATE_WINDOW;
      for (const [key, hits] of rateBuckets) {
        const filtered = hits.filter(t => Date.now() - t < RATE_WINDOW);
        if (filtered.length === 0) rateBuckets.delete(key); else rateBuckets.set(key, filtered);
      }
    }, 30 * 1000); // 每 30 秒清理过期条目
    this.app.use((req, res, next) => {
      if (!req.path.startsWith('/api/')) return next();
      const key = req.ip || 'unknown';
      const now = Date.now();
      if (!rateBuckets.has(key)) rateBuckets.set(key, []);
      let hits = rateBuckets.get(key);
      hits = hits.filter(t => now - t < RATE_WINDOW);
      hits.push(now);
      rateBuckets.set(key, hits);
      if (hits.length > RATE_MAX) {
        return res.status(429).json({ success: false, error: 'rate_limit_exceeded', retry_after: Math.ceil(RATE_WINDOW / 1000) });
      }
      next();
    });

    // Load modules
    await this._loadModules();

    // Start
        this.server = this.app.listen(this.config.port, '127.0.0.1');
    console.log(`\n⚪ Kernel started → http://localhost:${this.config.port}`);
    return this;
  }

  async _loadModules() {
    const modDir = path.join(this.rootDir, 'modules');
    if (!fs.existsSync(modDir)) return;

    const dirs = fs.readdirSync(modDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);

    const orderFile = path.join(modDir, '.order');
    if (fs.existsSync(orderFile)) {
      const order = fs.readFileSync(orderFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
      const ordered = order.filter(d => dirs.includes(d));
      const rest = dirs.filter(d => !ordered.includes(d));
      dirs.splice(0, dirs.length, ...ordered, ...rest);
    }

    for (const name of dirs) {
      await this._loadModule(name, path.join(modDir, name));
    }
  }

  async _loadModule(name, dir) {
    const modPath = path.join(dir, 'index.js');
    if (!fs.existsSync(modPath)) return;
    const mod = require(modPath);
    if (!mod.id) mod.id = name;
    if (!mod.version) mod.version = '0.1.0';

    const ctx = this._moduleContext();

    // 挂载 Bearer 认证中间件（在 session 之后、路由之前）
    this.app.use((req, res, next) => {
      req.bearerUser = null;
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        const key = auth.slice(7).trim();
        if (key) {
          try {
            const hash = crypto.createHash('sha256').update(key).digest('hex');
            const agent = this.db.prepare('SELECT id, username, display_name, role, agent_permissions FROM users WHERE agent_key = ?').get(hash);
            if (agent) {
              req.bearerUser = {
                id: agent.id,
                username: agent.username,
                display_name: agent.display_name,
                role: agent.role,
                permissions: safeParseJSON(agent.agent_permissions, {})
              };
              // 更新最后活跃时间
              try { this.db.prepare("UPDATE users SET last_api_at = datetime('now') WHERE id = ?").run(agent.id); } catch (e) {}
            }
          } catch (e) { /* 静默失败 */ }
        }
      }
      next();
    });

    // Schema
    const schemaPath = path.join(dir, 'schema.sql');
    if (fs.existsSync(schemaPath)) this.db.exec(fs.readFileSync(schemaPath, 'utf8'));

    // Boot
    if (mod.boot) await mod.boot(ctx);
    // Routes
    if (mod.routes) mod.routes(this.app, ctx);

    this.modules.set(mod.id, mod);
    this.db.prepare(`INSERT OR REPLACE INTO _kernel_modules (id, version, loaded_at) VALUES (?, ?, datetime('now'))`)
      .run(mod.id, mod.version);
    console.log(`  ✅ ${mod.id} v${mod.version}`);
  }

  _moduleContext() {
    return {
      kernel: this,
      db: this.db,
      app: this.app,
      t: (key) => translate(key, _requestLang),
      csrfToken: () => _requestCsrf,
      limiters: this._limiters || {},
      render: (title, user, content, lang) => this._wrapHTML(title, user, content, lang || _requestLang || _defaultLang),
      auth: {
        // GET 请求允许公开浏览，仅 POST 需要登录
        member: (req, res, next) => {
          if (req.method === 'GET' || req.method === 'HEAD') return next();
          if (!req.session.user) return res.redirect('/login');
          next();
        },
        admin: (req, res, next) => {
          if (req.method === 'GET' || req.method === 'HEAD') return next();
          if (!req.session.user) return res.redirect('/login');
          if (req.session.user.role !== 'admin') return res.status(403).send('⛔ ' + t('auth.admin_required'));
          next();
        },
        // Bearer 或 Session 均可（API 兼容）
        api: (req, res, next) => {
          if (req.bearerUser) return next();
          if (req.session.user) return next();
          return res.status(401).json({ success: false, error: 'unauthorized' });
        },
        // 仅 Bearer（智能体专用 API）
        agent: (req, res, next) => {
          if (!req.bearerUser) return res.status(401).json({ success: false, error: 'agent_key_required' });
          next();
        }
      },
      // 智能体权限范围检查
      checkAgentScope: (agentPermissions, scope, challengeId) => {
        // scope: 'submit_scope' | 'vote_scope'
        const scoped = agentPermissions && agentPermissions[scope];
        if (!scoped || !scoped.challenge_ids) return true; // 无范围限制
        if (!challengeId) return false;
        return scoped.challenge_ids.includes(challengeId);
      },
      generateUserCode: (dateStr) => this._generateUserCode(dateStr),
      notifications: {
        create: (userId, type, title, message, link) => {
          const id = uuidv4();
          this.db.prepare('INSERT INTO notifications (id, user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, userId, type, title, message || '', link || '');
        }
      }
    };
  }

  _generateUserCode(dateStr) {
    // 日期前缀：YYMMDD（默认今天）
    if (!dateStr) {
      const d = new Date();
      dateStr = d.getFullYear().toString().slice(2) +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0');
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code;
    for (let attempt = 0; attempt < 20; attempt++) {
      // 后 4 位随机
      let suffix = '';
      for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
      code = dateStr + suffix;
      const existing = this.db.prepare('SELECT id FROM users WHERE user_code = ?').get(code);
      if (!existing) return code;
    }
    // 极低概率触达：后 4 位追加 hex
    return code + crypto.randomBytes(2).toString('hex');
  }

  getModule(id) { return this.modules.get(id); }

  async stop() { if (this.server) this.server.close(); if (this.db) this.db.close(); }

  // ── HTML 包装器（支持多语言）──
  _wrapHTML(title, user, content, lang) {
    const curLang = _supportedLangs.includes(lang) ? lang : _defaultLang;
    const t = (key) => translate(key, curLang);
    const escape = (s) => { if (!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
        const langOptions = _supportedLangs.map(l =>
      `<a href="/lang/${l}" class="lang-option${l === curLang ? ' active' : ''}" data-lang="${l}">${t('lang.' + l)}</a>
    `).join('');
    const langSwitcher = `<div class="lang-hover" id="lang-switcher">
      <a href="javascript:void(0)" class="lang-btn">${t('nav.lang_switch')}</a>
      <div class="lang-dropdown" style="display:none">${langOptions}</div>
    </div>`;

    const notifyBadge = _unreadCount > 0 ? `<span class="notify-badge">${_unreadCount > 9 ? '9+' : _unreadCount}</span>` : '';
    const nav = user ? `<nav>
      <a href="/" class="nav-brand">⚪ ${escape(t('home.brand'))}</a>
      <div class="nav-links">
        <a href="/">${t('nav.home')}${notifyBadge}</a>
        <a href="/members">${t('nav.members')}</a>
        <a href="/agents">🤖 ${t('nav.agents')}</a>
        <a href="/test">${t('nav.test')}</a>
        <a href="/submissions">${t('nav.submissions')}</a>
        <a href="/notifications">${t('nav.notifications')}</a>
        ${langSwitcher}
        <span class="nav-user">${escape(user.display_name)}</span>
        <a href="/logout">${t('nav.logout')}</a>
      </div>
    </nav>` : `<nav>
      <a href="/" class="nav-brand">⚪ ${escape(t('home.brand'))}</a>
      <div class="nav-links">
        <a href="/">${t('nav.home')}</a>
        <a href="/members">${t('nav.members')}</a>
        <a href="/agents">🤖 ${t('nav.agents')}</a>
        <a href="/test">${t('nav.test')}</a>
        <a href="/submissions">${t('nav.submissions')}</a>
        <a href="/login">${t('nav.login')}</a>
        ${langSwitcher}
      </div>
    </nav>`;

    const htmlLang = curLang === 'zh' ? 'zh-CN' : 'en';
    return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || t('home.title')}</title>
  <link rel="stylesheet" href="/style.css">
  <link rel="icon" type="image/svg+xml" href="/logo.svg">
  <meta name="description" content="${t('home.subtitle')}">
  <meta name="csrf-token" content="${_requestCsrf}">
</head>
<body>
  ${nav}
  <main>${content}</main>
  <footer><p>⚪ ${t('home.tagline')} · ${t('home.title')}${user && user.role === 'admin' ? ` · <a href="/admin" style="color:var(--text-muted);text-decoration:none">${t('nav.admin')}</a>` : ''}</p></footer>
  <script src="/script.js"></script>
<script>
(function(){
var b=document.querySelector('.lang-btn');
if(b){b.onclick=function(e){e.stopPropagation();var d=this.nextElementSibling;if(d.style.display==='none'){d.style.display='block'}else{d.style.display='none'}}};
document.addEventListener('click',function(){var d=document.querySelector('.lang-dropdown');if(d&&d.style.display!=='none'){d.style.display='none'}},false);
document.querySelectorAll('.lang-option').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var l=this.dataset.lang;if(!l)return;var x=new XMLHttpRequest();x.open('GET','/lang/'+l);x.setRequestHeader('X-Requested-With','XMLHttpRequest');x.onload=function(){location.reload()};x.onerror=function(){location.reload()};x.send()})});
})();
</script>
</body>
</html>`;
  }
}

function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

module.exports = { Kernel };

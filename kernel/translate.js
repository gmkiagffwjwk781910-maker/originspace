// ⚪ 原点社区 · 用户内容翻译服务
// 通过 Ollama(Gemma4) 将用户生成内容翻译为英文，并缓存到 translations 表
// 支持三种模式：
//   1. 缓存查询（同步） — getCached()
//   2. Ollama 调用（异步） — translateText()
//   3. 预翻译批处理 — preTranslateAll()
const crypto = require('crypto');
const http = require('http');

const OLLAMA_URL = 'http://localhost:11434';

// ── 缓存操作（同步） ──

function getCached(db, text, targetLang = 'en') {
  if (!text || targetLang === 'zh') return null;
  const h = crypto.createHash('sha256').update(text).digest('hex');
  const row = db.prepare('SELECT translated_text FROM translations WHERE source_hash = ? AND target_lang = ?').get(h, targetLang);
  return row ? row.translated_text : null;
}

function setCached(db, text, translated, targetLang = 'en') {
  const h = crypto.createHash('sha256').update(text).digest('hex');
  db.prepare(`INSERT OR REPLACE INTO translations (source_hash, target_lang, source_text, translated_text, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))`).run(h, targetLang, text, translated);
}

// ── Ollama 翻译（异步） ──

function ollamaTranslate(text, targetLang = 'en') {
  const langName = targetLang === 'en' ? 'English' : targetLang;
  const prompt = `Translate the following Chinese text to ${langName}. Preserve any emoji, special characters, and line breaks. Return ONLY the translation, no explanations.\n\n${text}`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gemma4',
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 1024 }
    });

    const req = http.request(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const translated = (parsed.response || '').trim();
          resolve(translated || text);
        } catch (e) {
          reject(new Error('translate parse: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function translateText(text, targetLang = 'en') {
  if (!text || targetLang === 'zh') return text;
  try {
    const result = await ollamaTranslate(text, targetLang);
    return result;
  } catch (e) {
    console.error('  ⚠️ translateText error:', e.message);
    return text; // fallback to original
  }
}

// ── 预翻译批处理 ──

async function preTranslateAll(db, logFn) {
  logFn = logFn || console.log;
  logFn('  🔄 预翻译用户内容...');

  // 安全检查：translations 表是否存在
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='translations'").get();
  if (!tableExists) {
    logFn('  ⚠️  translations 表不存在，跳过预翻译');
    return;
  }

  const sources = [];

  // submissions
  const subs = db.prepare("SELECT id, problem_statement, solution_framework, collaboration_note FROM submissions").all();
  for (const s of subs) {
    if (s.problem_statement) sources.push({ source: 'submission', id: s.id, text: s.problem_statement, field: 'problem_statement' });
    if (s.solution_framework) sources.push({ source: 'submission', id: s.id, text: s.solution_framework, field: 'solution_framework' });
    if (s.collaboration_note) sources.push({ source: 'submission', id: s.id, text: s.collaboration_note, field: 'collaboration_note' });
  }

  // proposals
  const props = db.prepare("SELECT id, title, description FROM proposals").all();
  for (const p of props) {
    if (p.title) sources.push({ source: 'proposal', id: p.id, text: p.title, field: 'title' });
    if (p.description) sources.push({ source: 'proposal', id: p.id, text: p.description, field: 'description' });
  }

  // challenges
  const challs = db.prepare("SELECT id, title, description, instructions FROM challenges").all();
  for (const c of challs) {
    if (c.title) sources.push({ source: 'challenge', id: c.id, text: c.title, field: 'title' });
    if (c.description) sources.push({ source: 'challenge', id: c.id, text: c.description, field: 'description' });
    if (c.instructions) sources.push({ source: 'challenge', id: c.id, text: c.instructions, field: 'instructions' });
  }

  // users (display_name, bio)
  // Skip - users are more dynamic and less important for translation

  logFn(`  📦 发现 ${sources.length} 条待翻译内容`);

  let done = 0;
  for (const src of sources) {
    const existing = getCached(db, src.text, 'en');
    if (existing) { done++; continue; }

    try {
      const translated = await translateText(src.text, 'en');
      setCached(db, src.text, translated, 'en');
      done++;
      if (done % 3 === 0 || done === sources.length) {
        logFn(`  ✅ ${done}/${sources.length}`);
      }
    } catch (e) {
      logFn(`  ⚠️  翻译失败 [${src.source}#${src.id}]: ${e.message}`);
    }

    // 防止 Ollama 过载
    await new Promise(r => setTimeout(r, 500));
  }

  logFn(`  ✨ 预翻译完成 (${done}/${sources.length})`);
}

// ── 渲染辅助 ──

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 渲染翻译后的用户内容（用于模板字符串）
 * @param {string} text - 原始文本（中文）
 * @param {string} lang - 当前语言 ('zh'|'en')
 * @param {object} db - better-sqlite3 实例
 * @param {function} escapeFn - HTML 转义函数，默认 escapeHtml
 * @returns {string} HTML 字符串
 */
function renderTranslated(text, lang, db, escapeFn) {
  if (!text) return '';
  escapeFn = escapeFn || escapeHtml;

  // 中文模式：直接显示原文
  if (!lang || lang === 'zh') {
    return escapeFn(text);
  }

  // 英文模式：查缓存
  const cached = getCached(db, text, 'en');
  const escapedOrig = escapeFn(text);

  if (cached) {
    const escapedTrans = escapeFn(cached);
    return `<span class="tr-text">${escapedTrans}</span><span class="tr-orig" style="display:none">${escapedOrig}</span> <a href="#" class="tr-toggle" onclick="event.preventDefault();var p=this.previousElementSibling.previousElementSibling;if(p.style.display==='none'){this.previousElementSibling.style.display='none';p.style.display='';this.textContent='Show original'}else{this.previousElementSibling.style.display='';p.style.display='none';this.textContent='Show translation'}" class="tr-link">Show original</a>`;
  }

  // 未缓存：显示原文 + translate 按钮
  return `<span class="tr-text" data-tr="${escapeFn(text)}">${escapedOrig}</span> <a href="#" class="tr-btn" onclick="event.preventDefault();translateClick(this)" class="tr-link">🌐 Translate</a>`;
}

module.exports = { getCached, setCached, translateText, preTranslateAll, renderTranslated, escapeHtml };

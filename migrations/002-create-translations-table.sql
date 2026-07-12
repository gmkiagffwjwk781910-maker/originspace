-- description: 创建翻译缓存表

CREATE TABLE IF NOT EXISTS translations (
  source_hash TEXT NOT NULL,
  target_lang TEXT NOT NULL DEFAULT 'en',
  source_text TEXT NOT NULL DEFAULT '',
  translated_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_hash, target_lang)
);

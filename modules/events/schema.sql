-- 事件日志（append-only，真相源）
CREATE TABLE IF NOT EXISTS event_log (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor_id TEXT,
  actor_type TEXT DEFAULT 'human',
  timestamp TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT,
  prev_hash TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(type);
CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_event_log_actor ON event_log(actor_id);

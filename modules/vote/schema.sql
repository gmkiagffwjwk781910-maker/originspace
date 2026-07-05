-- 投票模块
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  voter_id TEXT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK(decision IN ('approve','reject')),
  weight REAL NOT NULL DEFAULT 1.0,
  comment TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(submission_id, voter_id)
);

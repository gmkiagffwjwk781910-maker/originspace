-- 提案引擎
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  creator_id TEXT NOT NULL REFERENCES users(id),
  creator_type TEXT DEFAULT 'human',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'passed', 'rejected', 'expired', 'executed')),
  deadline TEXT NOT NULL,
  result_action TEXT DEFAULT '{}',
  votes_for INTEGER NOT NULL DEFAULT 0,
  votes_against INTEGER NOT NULL DEFAULT 0,
  votes_abstain INTEGER NOT NULL DEFAULT 0,
  total_voters INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tallied_at TEXT,
  executed_at TEXT
);

CREATE TABLE IF NOT EXISTS proposal_votes (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  voter_id TEXT NOT NULL REFERENCES users(id),
  voter_type TEXT DEFAULT 'human',
  vote TEXT NOT NULL CHECK(vote IN ('approve', 'reject', 'abstain')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(proposal_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_proposal_votes_pid ON proposal_votes(proposal_id);

-- 加权成员表（紧急刹车专用）
CREATE TABLE IF NOT EXISTS weighted_members (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  weight REAL NOT NULL DEFAULT 1.0,
  reason TEXT DEFAULT '',
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

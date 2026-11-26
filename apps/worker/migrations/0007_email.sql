-- Phase 5: email digest. Only a short summary is kept, never the message body.
CREATE TABLE IF NOT EXISTS email_digest (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('school','work','family','bills','other')),
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','proposed','dismissed')),
  proposal_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS email_received ON email_digest (received_at);

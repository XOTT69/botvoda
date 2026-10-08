CREATE TABLE IF NOT EXISTS publications (
  group_chat_id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL,
  bot_username TEXT NOT NULL,
  group_title TEXT,
  last_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

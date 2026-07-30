-- Schema for Shadow Channel Management Bot Users

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                    -- telegram user id
  username TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  language_code TEXT,                        -- For example: fa, en
  is_admin BOOLEAN DEFAULT FALSE,            -- ادمین بات (نه ادمین کانال)
  is_vip BOOLEAN DEFAULT FALSE,              -- VIP User: Exempt from the automatic cleanup of inactive users.
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- Index for fast searches
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);
CREATE INDEX IF NOT EXISTS idx_users_is_vip ON users(is_vip);

-- User activity log table (optional but recommended)
CREATE TABLE IF NOT EXISTS user_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
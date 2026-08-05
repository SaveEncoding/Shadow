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
-- Speeds up deleteInactiveUsers: WHERE updated_at < ... (and non-VIP filter)
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);

-- User activity log table (optional but recommended)
CREATE TABLE IF NOT EXISTS user_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Bot runtime settings (key-value). Used e.g. for error_log_chat_id.
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- Channels registered by users (via forwarding a post from their channel).
-- One row per channel — not per admin — so title/username/owner stay single-sourced.
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL UNIQUE,   -- telegram id of the channel itself
  title TEXT NOT NULL,
  username TEXT,                        -- channels can be private and have no username
  owner_id INTEGER,                     -- the channel's real creator; NULL until we observe a "creator"-status admin
  registered_by INTEGER NOT NULL,       -- the first user who registered this channel via the bot
  admins_synced_at TEXT,                -- last time channel_admins was refreshed via getChatAdministrators; NULL = never
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (registered_by) REFERENCES users(id),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_channels_channel_id ON channels(channel_id);
CREATE INDEX IF NOT EXISTS idx_channels_registered_by ON channels(registered_by);
CREATE INDEX IF NOT EXISTS idx_channels_admins_synced_at ON channels(admins_synced_at);

-- Which bot users can see/manage which channel (many-to-many).
-- The registrant is included here too (see registered_by on `channels` to know who was first).
CREATE TABLE IF NOT EXISTS channel_admins (
  channel_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  added_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_channel_admins_user_id ON channel_admins(user_id);

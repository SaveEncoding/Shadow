-- Schema for Shadow Channel Management Bot Users

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                    -- telegram user id
  username TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  language_code TEXT,                        -- For example: fa, en
  role INTEGER NOT NULL DEFAULT 0,           -- 0 NORMAL, 1 VIP, 2 EXEC_ADMIN, 3 DEVELOPER, 4 FOUNDER
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- Index for fast searches
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
-- Speeds up deleteInactiveUsers: WHERE updated_at < ... AND role < VIP
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
  official_suffix TEXT,                 -- footer text appended to channel posts
  official_suffix_entities TEXT,        -- JSON array of MessageEntity (offsets relative to official_suffix)
  suffix_skip_marker TEXT,              -- if this substring appears in post text/caption, auto-suffix is skipped
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

-- شطرنج: هر بازی یک ردیف. تخته از روی `moves` (آرایه‌ی JSON از SAN) بازسازی می‌شود،
-- بنابراین جدول فقط «منبع حقیقت تاریخچه» را نگه می‌دارد و fen صرفاً کش نمایش است.
CREATE TABLE IF NOT EXISTS chess_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,                 -- بازی به چت گره می‌خورد (در گروه، دو نفر روی یک صفحه بازی می‌کنند)
  user_id INTEGER NOT NULL,                 -- سازنده‌ی بازی (برای آمار)
  mode TEXT NOT NULL DEFAULT 'engine',      -- engine | local
  level INTEGER NOT NULL DEFAULT 2,         -- 1..4 (فقط در حالت engine)
  seed INTEGER NOT NULL DEFAULT 0,          -- برای بازتولیدپذیری انتخاب‌های موتور
  start_fen TEXT NOT NULL,                  -- وضعیت شروع (امکان بازی از موقعیت دلخواه در آینده)
  fen TEXT NOT NULL,                        -- وضعیت فعلی (کش)
  moves TEXT NOT NULL DEFAULT '[]',         -- JSON array of SAN
  status TEXT NOT NULL DEFAULT 'active',    -- active | finished | abandoned
  result TEXT,                              -- 1-0 | 0-1 | 1/2-1/2
  reason TEXT,                              -- checkmate | stalemate | resignation | ...
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_chess_games_chat ON chess_games(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_chess_games_user ON chess_games(user_id, status);

-- ───────────────────── کپی و زمان‌بندی پست کانال ─────────────────────
-- هر قانون: «هر پست جدید در کانال مبدأ، پس از N دقیقه در کانال مقصد منتشر شود».
-- این تأخیر عمدی است تا ادمین کانال مقصد فرصت ویرایش داشته باشد.
CREATE TABLE IF NOT EXISTS post_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_channel_id INTEGER NOT NULL UNIQUE,  -- کانال مبدأ (بات باید ادمین آن باشد)
  source_title TEXT,                          -- فقط برای نمایش در UI
  source_username TEXT,
  target_channel_id INTEGER NOT NULL,         -- کانال مقصد (بات باید اجازه‌ی ارسال داشته باشد)
  delay_minutes INTEGER NOT NULL DEFAULT 30,  -- پنجره‌ی ویرایش
  enabled INTEGER NOT NULL DEFAULT 1,
  notify_chat_id INTEGER,                     -- چتی که پیش‌نمایش برای ادمین فرستاده می‌شود
  added_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_post_sources_target ON post_sources(target_channel_id);

CREATE TABLE IF NOT EXISTS post_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_channel_id INTEGER NOT NULL,         -- 0 برای پست دستی (فوروارد)
  source_title TEXT,                          -- عنوان مبدأ در لحظه‌ی ثبت (برای UI)
  source_username TEXT,
  target_channel_id INTEGER NOT NULL,
  media_group_id TEXT,                        -- آلبوم‌ها: پیام‌های هم‌گروه یک پست‌اند
  status TEXT NOT NULL DEFAULT 'collecting',   -- collecting|scheduled|publishing|published|failed|canceled
  publish_at INTEGER NOT NULL,                -- ثانیه‌ی یونیکس
  finalize_at INTEGER,                        -- پایان مهلت جمع‌آوری آیتم‌های آلبوم
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  published_message_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_by INTEGER,
  preview_chat_id INTEGER,
  preview_message_id INTEGER,
  edited INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_post_queue_ready ON post_queue(status, publish_at);
CREATE INDEX IF NOT EXISTS idx_post_queue_target ON post_queue(target_channel_id, status, publish_at);
CREATE INDEX IF NOT EXISTS idx_post_queue_collect ON post_queue(source_channel_id, media_group_id, status);

CREATE TABLE IF NOT EXISTS post_queue_items (
  queue_id INTEGER NOT NULL,
  source_message_id INTEGER NOT NULL,         -- شناسه‌ی پیام در کانال مبدأ
  kind TEXT NOT NULL,                         -- text|photo|video|document|audio|voice|animation|sticker
  file_id TEXT,                               -- تلگرام: برای ارسال مجدد بدون آپلود
  text TEXT,                                  -- متن پست یا کپشن
  entities TEXT,                              -- JSON آرایه‌ی MessageEntity
  extra TEXT,                                 -- JSON: عرض/ارتفاع/مدت ویدیو
  PRIMARY KEY (queue_id, source_message_id),
  FOREIGN KEY (queue_id) REFERENCES post_queue(id) ON DELETE CASCADE
);

-- جلوگیری از ثبت دوباره‌ی همان پیام (retry وبهوک، آلبوم تکراری)
CREATE TABLE IF NOT EXISTS post_seen (
  source_channel_id INTEGER NOT NULL,
  source_message_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source_channel_id, source_message_id)
);

-- «منتظر متن جدید از ادمین» — در D1 نگه داشته می‌شود، نه در حافظه‌ی ایزوله،
-- چون هر درخواست می‌تواند روی ایزوله‌ی دیگری اجرا شود (بدهی فنی شناخته‌شده).
CREATE TABLE IF NOT EXISTS post_edit_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL UNIQUE,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  field TEXT NOT NULL,                        -- text|caption
  target_message_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- «منتظر فوروارد یک پست از ادمین» برای حالت کپی دستی
CREATE TABLE IF NOT EXISTS post_capture_sessions (
  user_id INTEGER PRIMARY KEY,
  target_channel_id INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'manual',        -- manual: پست دستی | source: ثبت کانال مبدأ
  delay_minutes INTEGER NOT NULL DEFAULT 30,
  expires_at INTEGER NOT NULL
);

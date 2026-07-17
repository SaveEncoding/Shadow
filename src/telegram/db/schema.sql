-- Schema برای کاربران بات مدیریت کانال Shadow

-- جدول کاربران
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                    -- telegram user id
  username TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  language_code TEXT,                        -- مثلاً fa, en
  is_admin BOOLEAN DEFAULT FALSE,            -- ادمین بات (نه ادمین کانال)
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- ایندکس برای جستجوهای سریع
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);

-- جدول لاگ فعالیت کاربران (اختیاری اما توصیه‌شده)
CREATE TABLE IF NOT EXISTS user_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
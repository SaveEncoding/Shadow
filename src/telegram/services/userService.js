/**
 * سرویس مدیریت کاربران در D1
 */
export class UserService {
  constructor(db) {
    this.db = db;   // env.my_database
  }

  /**
   * ثبت یا بروزرسانی کاربر هنگام اولین تعامل
   */
  async registerOrUpdate(user) {
    if (!user || !user.id) return null;

    const { id, username, first_name, last_name, language_code } = user;

    try {
      const result = await this.db
        .prepare(`
          INSERT INTO users (id, username, first_name, last_name, language_code, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            language_code = excluded.language_code,
            updated_at = CURRENT_TIMESTAMP
        `)
        .bind(
          id,
          username || null,
          first_name,
          last_name || null,
          language_code || null
        )
        .run();

      // لاگ ثبت کاربر جدید
      if (result.meta.changes > 0 && !await this.isUserExists(id)) {
        await this.logActivity(id, "register", "کاربر جدید ثبت شد");
      }

      return await this.getUser(id);
    } catch (err) {
      console.error("Error registering user:", err);
      throw err;
    }
  }

  async getUser(userId) {
    return await this.db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first();
  }

  async isUserExists(userId) {
    const user = await this.getUser(userId);
    return !!user;
  }

  async logActivity(userId, action, details = null) {
    await this.db
      .prepare(`
        INSERT INTO user_logs (user_id, action, details)
        VALUES (?, ?, ?)
      `)
      .bind(userId, action, details)
      .run();
  }

  async setAsBotAdmin(userId) {
    await this.db
      .prepare("UPDATE users SET is_admin = TRUE WHERE id = ?")
      .bind(userId)
      .run();
  }
}
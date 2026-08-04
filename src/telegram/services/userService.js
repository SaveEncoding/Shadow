/**
 * User Management Service in D1
 */
export class UserService {
  constructor(db) {
    this.db = db;   // env.my_database
  }

  /**
   * User registration or update upon first interaction.
   * Single D1 round-trip via INSERT ... ON CONFLICT ... RETURNING *.
   * New-user detection uses created_at === updated_at (both set on insert;
   * only updated_at changes on subsequent upserts).
   */
  async registerOrUpdate(user) {
    if (!user || !user.id) return null;

    const { id, username, first_name, last_name, language_code } = user;

    try {
      const row = await this.db
        .prepare(`
          INSERT INTO users (id, username, first_name, last_name, language_code, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            language_code = excluded.language_code,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `)
        .bind(
          id,
          username || null,
          first_name,
          last_name || null,
          language_code || null
        )
        .first();

      // New user: created_at and updated_at were set together on INSERT
      if (row && row.created_at === row.updated_at) {
        await this.logActivity(id, "register", "New user registered");
      }

      return row;
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

  /**
   * Marking/unmarking a user as VIP.
   * VIP users are exempt from the automatic cleanup of inactive users.
   */
  async setAsVip(userId, isVip = true) {
    await this.db
      .prepare("UPDATE users SET is_vip = ? WHERE id = ?")
      .bind(isVip ? 1 : 0, userId)
      .run();
  }

  /**
   * Deletes users who have had no interaction for more than `inactiveDays` days, excluding VIP users.
   * Used to optimize D1 storage space (typically executed via a cron trigger).
   * The user's logs are also deleted to prevent "orphan" rows (records without an associated user) from remaining in `user_logs`.
   *
   * @returns {Promise<{deletedCount: number, deletedIds: number[]}>}
   */
  async deleteInactiveUsers(inactiveDays = 30) {
    const { results } = await this.db
      .prepare(`
        SELECT id FROM users
        WHERE (is_vip IS NULL OR is_vip = 0)
          AND updated_at < datetime('now', ?)
      `)
      .bind(`-${inactiveDays} days`)
      .all();

    const idsToDelete = results.map((row) => row.id);

    if (idsToDelete.length === 0) {
      return { deletedCount: 0, deletedIds: [] };
    }

    const placeholders = idsToDelete.map(() => "?").join(", ");

    await this.db.batch([
      this.db.prepare(`DELETE FROM user_logs WHERE user_id IN (${placeholders})`).bind(...idsToDelete),
      this.db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).bind(...idsToDelete),
    ]);

    return { deletedCount: idsToDelete.length, deletedIds: idsToDelete };
  }
}
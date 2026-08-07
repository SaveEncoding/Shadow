import { Role, isValidRole } from "../constants/roles.js";
import { resolveFounderId } from "../config.js";

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

  /**
   * Effective role: FOUNDER_TELEGRAM_ID / legacy ADMINS always win over DB.
   * @param {number|string} userId
   * @param {object} [env]
   */
  async getEffectiveRole(userId, env = null) {
    const founderId = resolveFounderId(env);
    if (founderId != null && Number(userId) === Number(founderId)) {
      return Role.FOUNDER;
    }

    const user = await this.getUser(userId);
    if (!user) return Role.NORMAL;

    // Prefer role column; fall back to legacy is_vip only
    let role = Number(user.role ?? 0);
    if (user.is_vip && role < Role.VIP) role = Role.VIP;
    return role;
  }

  /**
   * Assign role with privilege checks.
   * - Cannot assign FOUNDER via API
   * - Actor must be EXEC_ADMIN+
   * - newRole must be strictly below actor's effective role (founder may assign up to DEVELOPER)
   */
  async setRole(actorId, targetId, newRole, env = null) {
    if (!isValidRole(newRole)) {
      throw new Error("سطح نقش نامعتبر است.");
    }
    if (newRole >= Role.FOUNDER) {
      throw new Error("نقش بنیان‌گذار فقط از طریق متغیر محیطی قابل تنظیم است.");
    }

    const actorRole = await this.getEffectiveRole(actorId, env);
    if (actorRole < Role.EXEC_ADMIN) {
      throw new Error("اجازه تغییر نقش را ندارید.");
    }
    if (newRole >= actorRole && actorRole < Role.FOUNDER) {
      throw new Error("نمی‌توانید نقشی برابر یا بالاتر از خودتان بدهید.");
    }

    const targetRole = await this.getEffectiveRole(targetId, env);
    if (targetRole >= Role.FOUNDER) {
      throw new Error("نقش بنیان‌گذار قابل تغییر از پنل نیست.");
    }
    if (targetRole >= actorRole && actorRole < Role.FOUNDER) {
      throw new Error("نمی‌توانید نقش کسی هم‌سطح یا بالاتر از خودتان را تغییر دهید.");
    }

    // Keep legacy is_vip in sync until that column is also removed
    const isVip = newRole >= Role.VIP ? 1 : 0;

    await this.db
      .prepare(
        `UPDATE users SET role = ?, is_vip = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .bind(newRole, isVip, targetId)
      .run();
  }

  /**
   * Promote user to EXEC_ADMIN via role (replaces legacy is_admin flag).
   * @deprecated prefer setRole(actorId, userId, Role.EXEC_ADMIN, env)
   */
  async setAsBotAdmin(userId) {
    await this.db
      .prepare(
        `UPDATE users SET role = CASE WHEN COALESCE(role, 0) < ? THEN ? ELSE role END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .bind(Role.EXEC_ADMIN, Role.EXEC_ADMIN, userId)
      .run();
  }

  /**
   * Marking/unmarking a user as VIP.
   * VIP users are exempt from the automatic cleanup of inactive users.
   * @deprecated prefer setRole
   */
  async setAsVip(userId, isVip = true) {
    // Do not touch updated_at — VIP flag is not user activity; otherwise
    // un-VIP + cleanup would skip the user because they look "fresh".
    if (isVip) {
      await this.db
        .prepare(
          `UPDATE users SET is_vip = 1, role = CASE WHEN COALESCE(role, 0) < ? THEN ? ELSE role END WHERE id = ?`
        )
        .bind(Role.VIP, Role.VIP, userId)
        .run();
    } else {
      await this.db
        .prepare(
          `UPDATE users SET is_vip = 0, role = CASE WHEN COALESCE(role, 0) = ? THEN 0 ELSE role END WHERE id = ?`
        )
        .bind(Role.VIP, userId)
        .run();
    }
  }

  /**
   * Deletes users who have had no interaction for more than `inactiveDays` days,
   * excluding VIP and higher (role >= VIP).
   *
   * @returns {Promise<{deletedCount: number, deletedIds: number[]}>}
   */
  async deleteInactiveUsers(inactiveDays = 30) {
    const { results } = await this.db
      .prepare(`
        SELECT id FROM users
        WHERE COALESCE(role, 0) < ?
          AND (is_vip IS NULL OR is_vip = 0)
          AND updated_at < datetime('now', ?)
      `)
      .bind(Role.VIP, `-${inactiveDays} days`)
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

  /** Count users per role level (0–4). */
  async getRoleStats() {
    const { results } = await this.db
      .prepare(
        `SELECT COALESCE(role, 0) AS role, COUNT(*) AS cnt FROM users GROUP BY COALESCE(role, 0)`
      )
      .all();

    const stats = {
      [Role.NORMAL]: 0,
      [Role.VIP]: 0,
      [Role.EXEC_ADMIN]: 0,
      [Role.DEVELOPER]: 0,
      [Role.FOUNDER]: 0,
    };
    for (const row of results || []) {
      const r = Number(row.role);
      if (r in stats) stats[r] = Number(row.cnt);
    }
    return stats;
  }

  /** Users with role >= minRole, ordered by role desc. */
  async listUsersWithMinRole(minRole = Role.VIP) {
    const { results } = await this.db
      .prepare(
        `SELECT id, username, first_name, last_name, role, is_vip
         FROM users
         WHERE COALESCE(role, 0) >= ? OR is_vip = 1
         ORDER BY COALESCE(role, 0) DESC, id ASC
         LIMIT 100`
      )
      .bind(minRole)
      .all();
    return results || [];
  }
}

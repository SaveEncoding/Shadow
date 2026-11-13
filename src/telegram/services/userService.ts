import { Role, isValidRole } from '../constants/roles.js';
import { resolveFounderId, type FounderEnv } from '../config.js';
import type { UserRow } from '../db/rows.js';

/** فیلدهایی از پیام تلگرام که برای ثبت/به‌روزرسانی کاربر لازم است */
export interface TelegramUserLike {
	id: number;
	username?: string | null;
	first_name: string;
	last_name?: string | null;
	language_code?: string | null;
}

/** آمار تعداد کاربر در هر سطح نقش */
export type RoleStats = Record<number, number>;

/**
 * User Management Service in D1
 */
export class UserService {
	readonly db: D1Database;

	constructor(db: D1Database) {
		this.db = db; // env.my_database
	}

	/**
	 * User registration or update upon first interaction.
	 * Single D1 round-trip via INSERT ... ON CONFLICT ... RETURNING *.
	 * New-user detection uses created_at === updated_at (both set on insert;
	 * only updated_at changes on subsequent upserts).
	 */
	async registerOrUpdate(user: TelegramUserLike | null | undefined): Promise<UserRow | null> {
		if (!user || !user.id) return null;

		const { id, username, first_name, last_name, language_code } = user;

		try {
			const row = await this.db
				.prepare(
					`
          INSERT INTO users (id, username, first_name, last_name, language_code, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            language_code = excluded.language_code,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `,
				)
				.bind(id, username || null, first_name, last_name || null, language_code || null)
				.first<UserRow>();

			// New user: created_at and updated_at were set together on INSERT
			if (row && row.created_at === row.updated_at) {
				await this.logActivity(id, 'register', 'New user registered');
			}

			return row;
		} catch (err) {
			console.error('Error registering user:', err);
			throw err;
		}
	}

	async getUser(userId: number): Promise<UserRow | null> {
		return await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<UserRow>();
	}

	async isUserExists(userId: number): Promise<boolean> {
		const user = await this.getUser(userId);
		return !!user;
	}

	async logActivity(userId: number, action: string, details: string | null = null): Promise<void> {
		await this.db
			.prepare(
				`
        INSERT INTO user_logs (user_id, action, details)
        VALUES (?, ?, ?)
      `,
			)
			.bind(userId, action, details)
			.run();
	}

	/** نقش مؤثر: FOUNDER_TELEGRAM_ID (env) همیشه بر DB اولویت دارد. */
	async getEffectiveRole(userId: number | string, env: FounderEnv | null = null): Promise<number> {
		const founderId = resolveFounderId(env);
		if (founderId != null && Number(userId) === Number(founderId)) {
			return Role.FOUNDER;
		}

		// ستون `users.id` عددی است؛ ورودی رشته‌ای فقط از فراخوان‌های JS می‌آید و
		// SQLite هم با affinity همین تبدیل را انجام می‌دهد، پس نتیجه یکی است.
		const user = await this.getUser(Number(userId));
		if (!user) return Role.NORMAL;

		return Number(user.role ?? 0);
	}

	/**
	 * Assign role with privilege checks.
	 * - Cannot assign FOUNDER via API
	 * - Actor must be EXEC_ADMIN+
	 * - newRole must be strictly below actor's effective role (founder may assign up to DEVELOPER)
	 */
	async setRole(actorId: number | string, targetId: number | string, newRole: number, env: FounderEnv | null = null): Promise<void> {
		if (!isValidRole(newRole)) {
			throw new Error('سطح نقش نامعتبر است.');
		}
		if (newRole >= Role.FOUNDER) {
			throw new Error('نقش بنیان‌گذار فقط از طریق متغیر محیطی قابل تنظیم است.');
		}

		const actorRole = await this.getEffectiveRole(actorId, env);
		if (actorRole < Role.EXEC_ADMIN) {
			throw new Error('اجازه تغییر نقش را ندارید.');
		}
		if (newRole >= actorRole && actorRole < Role.FOUNDER) {
			throw new Error('نمی‌توانید نقشی برابر یا بالاتر از خودتان بدهید.');
		}

		const targetRole = await this.getEffectiveRole(targetId, env);
		if (targetRole >= Role.FOUNDER) {
			throw new Error('نقش بنیان‌گذار قابل تغییر از پنل نیست.');
		}
		if (targetRole >= actorRole && actorRole < Role.FOUNDER) {
			throw new Error('نمی‌توانید نقش کسی هم‌سطح یا بالاتر از خودتان را تغییر دهید.');
		}

		// Role changes are admin actions, not end-user activity — still update
		// updated_at so the row reflects the privilege change timestamp.
		await this.db.prepare(`UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(newRole, targetId).run();
	}

	/**
	 * Promote user to EXEC_ADMIN via role (replaces legacy is_admin flag).
	 * @deprecated prefer setRole(actorId, userId, Role.EXEC_ADMIN, env)
	 */
	async setAsBotAdmin(userId: number): Promise<void> {
		await this.db
			.prepare(`UPDATE users SET role = CASE WHEN COALESCE(role, 0) < ? THEN ? ELSE role END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
			.bind(Role.EXEC_ADMIN, Role.EXEC_ADMIN, userId)
			.run();
	}

	/**
	 * Convenience: set role to VIP or NORMAL.
	 * Does not touch updated_at (not user activity) so cleanup still sees true inactivity.
	 * Prefer setRole(actorId, userId, Role.VIP|NORMAL, env) when actor checks matter.
	 * @deprecated prefer setRole
	 */
	async setAsVip(userId: number, isVip = true): Promise<void> {
		if (isVip) {
			await this.db
				.prepare(`UPDATE users SET role = CASE WHEN COALESCE(role, 0) < ? THEN ? ELSE role END WHERE id = ?`)
				.bind(Role.VIP, Role.VIP, userId)
				.run();
		} else {
			// Only demote pure VIP → NORMAL; higher roles stay untouched
			await this.db.prepare(`UPDATE users SET role = 0 WHERE id = ? AND COALESCE(role, 0) = ?`).bind(userId, Role.VIP).run();
		}
	}

	/**
	 * Deletes users who have had no interaction for more than `inactiveDays` days,
	 * excluding VIP and higher (role >= VIP).
	 *
	 * Users who still "own" channel rows are never deleted (registered_by is NOT NULL,
	 * owner_id is FK): that would raise SQLITE_CONSTRAINT_FOREIGNKEY. Pure
	 * channel_admins membership is cleared first, then logs, then the user row.
	 */
	async deleteInactiveUsers(inactiveDays = 30): Promise<{ deletedCount: number; deletedIds: number[] }> {
		const { results } = await this.db
			.prepare(
				`
        SELECT id FROM users
        WHERE COALESCE(role, 0) < ?
          AND updated_at < datetime('now', ?)
          AND id NOT IN (SELECT registered_by FROM channels)
          AND id NOT IN (SELECT owner_id FROM channels WHERE owner_id IS NOT NULL)
      `,
			)
			.bind(Role.VIP, `-${inactiveDays} days`)
			.all<{ id: number }>();

		const idsToDelete = results.map((row) => row.id);

		if (idsToDelete.length === 0) {
			return { deletedCount: 0, deletedIds: [] };
		}

		const placeholders = idsToDelete.map(() => '?').join(', ');

		// Order matters: dependents first, then users (FK-safe).
		await this.db.batch([
			this.db.prepare(`DELETE FROM channel_admins WHERE user_id IN (${placeholders})`).bind(...idsToDelete),
			this.db.prepare(`DELETE FROM user_logs WHERE user_id IN (${placeholders})`).bind(...idsToDelete),
			this.db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).bind(...idsToDelete),
		]);

		return { deletedCount: idsToDelete.length, deletedIds: idsToDelete };
	}

	/** Count users per role level (0–4). */
	async getRoleStats(): Promise<RoleStats> {
		const { results } = await this.db
			.prepare(`SELECT COALESCE(role, 0) AS role, COUNT(*) AS cnt FROM users GROUP BY COALESCE(role, 0)`)
			.all<{ role: number; cnt: number }>();

		const stats: RoleStats = {
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
	async listUsersWithMinRole(minRole = Role.VIP): Promise<UserRow[]> {
		const { results } = await this.db
			.prepare(
				`SELECT id, username, first_name, last_name, role
         FROM users
         WHERE COALESCE(role, 0) >= ?
         ORDER BY COALESCE(role, 0) DESC, id ASC
         LIMIT 100`,
			)
			.bind(minRole)
			.all<UserRow>();
		return results || [];
	}
}

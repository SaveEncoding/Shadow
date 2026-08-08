import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { UserService } from '../src/telegram/services/userService.js';
import { Role } from '../src/telegram/constants/roles.js';

beforeAll(async () => {
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, first_name TEXT NOT NULL, last_name TEXT, language_code TEXT, role INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));'
	);
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS user_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, action TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), FOREIGN KEY (user_id) REFERENCES users(id));'
	);
});

async function insertUser(id, { daysAgo = 0, role = Role.NORMAL } = {}) {
	await env.my_database
		.prepare(
			`
      INSERT INTO users (id, first_name, role, updated_at)
      VALUES (?, ?, ?, datetime('now', ?))
    `
		)
		.bind(id, `user-${id}`, role, `-${daysAgo} days`)
		.run();
}

describe('UserService.deleteInactiveUsers', () => {
	it('deletes inactive NORMAL users and keeps active / role>=VIP', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(1, { daysAgo: 40 });
		await insertUser(2, { daysAgo: 5 });
		await insertUser(3, { daysAgo: 90, role: Role.VIP });

		const result = await userService.deleteInactiveUsers(30);

		expect(result.deletedCount).toBe(1);
		expect(result.deletedIds).toEqual([1]);
		expect(await userService.getUser(1)).toBeFalsy();
		expect(await userService.getUser(2)).toBeTruthy();
		expect(await userService.getUser(3)).toBeTruthy();
	});

	it('keeps inactive EXEC_ADMIN and higher', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(4, { daysAgo: 90, role: Role.EXEC_ADMIN });

		const result = await userService.deleteInactiveUsers(30);
		expect(result.deletedIds).not.toContain(4);
		expect(await userService.getUser(4)).toBeTruthy();
	});

	it("also removes the inactive user's logs, leaving no orphaned rows", async () => {
		const userService = new UserService(env.my_database);
		await insertUser(10, { daysAgo: 45 });
		await userService.logActivity(10, 'test-action');

		await userService.deleteInactiveUsers(30);

		const { results } = await env.my_database
			.prepare('SELECT * FROM user_logs WHERE user_id = ?')
			.bind(10)
			.all();
		expect(results.length).toBe(0);
	});

	it('does nothing and returns a zero count when there is nothing to delete', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(20, { daysAgo: 1 });

		const result = await userService.deleteInactiveUsers(30);
		expect(result.deletedCount).toBe(0);
		expect(result.deletedIds).toEqual([]);
		expect(await userService.getUser(20)).toBeTruthy();
	});
});

describe('UserService.setAsVip (role-only helper)', () => {
	it('raises role to VIP so the user survives cleanup', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(30, { daysAgo: 60, role: Role.NORMAL });

		await userService.setAsVip(30, true);
		expect(Number((await userService.getUser(30)).role)).toBe(Role.VIP);

		await userService.deleteInactiveUsers(30);
		expect(await userService.getUser(30)).toBeTruthy();
	});

	it('demotes pure VIP to NORMAL without refreshing updated_at', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(31, { daysAgo: 60, role: Role.VIP });

		await userService.setAsVip(31, false);
		expect(Number((await userService.getUser(31)).role)).toBe(Role.NORMAL);

		await userService.deleteInactiveUsers(30);
		expect(await userService.getUser(31)).toBeFalsy();
	});

	it('does not demote EXEC_ADMIN when setAsVip(false)', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(32, { daysAgo: 60, role: Role.EXEC_ADMIN });

		await userService.setAsVip(32, false);
		expect(Number((await userService.getUser(32)).role)).toBe(Role.EXEC_ADMIN);
	});
});

describe('UserService.getEffectiveRole', () => {
	it('returns FOUNDER for FOUNDER_TELEGRAM_ID regardless of DB role', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(100, { role: Role.NORMAL });
		const role = await userService.getEffectiveRole(100, {
			FOUNDER_TELEGRAM_ID: '100',
		});
		expect(role).toBe(Role.FOUNDER);
	});

	it('does not fall back to any hardcoded founder id when env secret is missing', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(102, { role: Role.NORMAL });
		const role = await userService.getEffectiveRole(102, {});
		expect(role).toBe(Role.NORMAL);
	});

	it('reads role from DB for ordinary users', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(101, { role: Role.DEVELOPER });
		const role = await userService.getEffectiveRole(101, {
			FOUNDER_TELEGRAM_ID: '999999',
		});
		expect(role).toBe(Role.DEVELOPER);
	});
});

describe('UserService.setRole', () => {
	it('allows founder to assign VIP/EXEC_ADMIN/DEVELOPER', async () => {
		const userService = new UserService(env.my_database);
		const founderId = 200;
		const targetId = 201;
		await insertUser(founderId, { role: Role.NORMAL });
		await insertUser(targetId, { role: Role.NORMAL });

		const envFounder = { FOUNDER_TELEGRAM_ID: String(founderId) };
		await userService.setRole(founderId, targetId, Role.VIP, envFounder);
		expect(Number((await userService.getUser(targetId)).role)).toBe(Role.VIP);

		await userService.setRole(founderId, targetId, Role.DEVELOPER, envFounder);
		expect(Number((await userService.getUser(targetId)).role)).toBe(Role.DEVELOPER);
	});

	it('rejects assigning FOUNDER via API', async () => {
		const userService = new UserService(env.my_database);
		const founderId = 210;
		await insertUser(founderId, { role: Role.NORMAL });
		await insertUser(211, { role: Role.NORMAL });
		await expect(
			userService.setRole(founderId, 211, Role.FOUNDER, {
				FOUNDER_TELEGRAM_ID: String(founderId),
			})
		).rejects.toThrow();
	});

	it('rejects role changes by NORMAL users', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(220, { role: Role.NORMAL });
		await insertUser(221, { role: Role.NORMAL });
		await expect(
			userService.setRole(220, 221, Role.VIP, { FOUNDER_TELEGRAM_ID: '999' })
		).rejects.toThrow();
	});

	it('rejects assigning a role >= actor role for non-founder admins', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(230, { role: Role.EXEC_ADMIN });
		await insertUser(231, { role: Role.NORMAL });
		await expect(
			userService.setRole(230, 231, Role.EXEC_ADMIN, {
				FOUNDER_TELEGRAM_ID: '999',
			})
		).rejects.toThrow();
	});
});

describe('UserService.getRoleStats / listUsersWithMinRole', () => {
	it('aggregates counts per role level', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(300, { role: Role.NORMAL });
		await insertUser(301, { role: Role.VIP });
		await insertUser(302, { role: Role.VIP });

		const stats = await userService.getRoleStats();
		expect(stats[Role.VIP]).toBeGreaterThanOrEqual(2);
		expect(stats[Role.NORMAL]).toBeGreaterThanOrEqual(1);
	});

	it('lists privileged users', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(310, { role: Role.EXEC_ADMIN });
		const rows = await userService.listUsersWithMinRole(Role.VIP);
		expect(rows.some((r) => Number(r.id) === 310)).toBe(true);
	});
});

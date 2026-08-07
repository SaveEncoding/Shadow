import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { UserService } from '../src/telegram/services/userService.js';

beforeAll(async () => {
	// In the test environment, D1 is empty; we manually execute the schema.sql file.
	// Note: env.my_database.exec() separates statements by newlines,
	// so each CREATE TABLE statement must be written on a single line.
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, first_name TEXT NOT NULL, last_name TEXT, language_code TEXT, is_vip BOOLEAN DEFAULT FALSE, role INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));'
	);
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS user_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, action TEXT NOT NULL, details TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), FOREIGN KEY (user_id) REFERENCES users(id));'
	);
});

async function insertUser(id, { daysAgo = 0, isVip = false } = {}) {
	const role = isVip ? 1 : 0; // Role.VIP
	await env.my_database
		.prepare(`
      INSERT INTO users (id, first_name, is_vip, role, updated_at)
      VALUES (?, ?, ?, ?, datetime('now', ?))
    `)
		.bind(id, `user-${id}`, isVip ? 1 : 0, role, `-${daysAgo} days`)
		.run();
}

describe('UserService.deleteInactiveUsers', () => {
	it('deletes non-VIP users inactive for longer than the threshold, and keeps the rest', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(1, { daysAgo: 40 }); // inactive -> should be deleted
		await insertUser(2, { daysAgo: 5 }); // active -> should stay
		await insertUser(3, { daysAgo: 90, isVip: true }); // VIP -> should stay regardless of inactivity

		const result = await userService.deleteInactiveUsers(30);

		expect(result.deletedCount).toBe(1);
		expect(result.deletedIds).toEqual([1]);

		expect(await userService.getUser(1)).toBeFalsy();
		expect(await userService.getUser(2)).toBeTruthy();
		expect(await userService.getUser(3)).toBeTruthy();
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

describe('UserService.setAsVip', () => {
	it('marks a user as VIP so they survive cleanup', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(30, { daysAgo: 60 });

		await userService.setAsVip(30, true);
		await userService.deleteInactiveUsers(30);

		expect(await userService.getUser(30)).toBeTruthy();
	});

	it('un-marking VIP makes the user eligible for cleanup again', async () => {
		const userService = new UserService(env.my_database);
		await insertUser(31, { daysAgo: 60, isVip: true });

		await userService.setAsVip(31, false);
		await userService.deleteInactiveUsers(30);

		expect(await userService.getUser(31)).toBeFalsy();
	});
});

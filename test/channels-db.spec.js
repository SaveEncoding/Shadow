import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import {
	registerChannel,
	getChannels,
	removeChannelAdmin,
	getChannelsNeedingAdminSync,
	syncChannelAdmins,
} from '../src/telegram/db/channels.js';

beforeAll(async () => {
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, first_name TEXT NOT NULL, last_name TEXT, language_code TEXT, role INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));'
	);
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL UNIQUE, title TEXT NOT NULL, username TEXT, owner_id INTEGER, registered_by INTEGER NOT NULL, admins_synced_at TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP), FOREIGN KEY (registered_by) REFERENCES users(id), FOREIGN KEY (owner_id) REFERENCES users(id));'
	);
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS channel_admins (channel_id INTEGER NOT NULL, user_id INTEGER NOT NULL, added_at TEXT DEFAULT (CURRENT_TIMESTAMP), PRIMARY KEY (channel_id, user_id), FOREIGN KEY (channel_id) REFERENCES channels(channel_id), FOREIGN KEY (user_id) REFERENCES users(id));'
	);

	// registerChannel/channel_admins هر دو به وجود کاربر توی جدول users وابسته‌ن
	for (const id of [1, 2, 3, 4, 5, 6, 7]) {
		await env.my_database
			.prepare('INSERT INTO users (id, first_name) VALUES (?, ?)')
			.bind(id, `user-${id}`)
			.run();
	}
});

describe('registerChannel', () => {
	it('creates a new channel with the registrant recorded, no owner assigned when not a creator', async () => {
		const result = await registerChannel(env.my_database, 1, { id: -100111, title: 'Channel One', username: 'chone' });

		expect(result).toEqual({ isNewChannel: true, ownerAssigned: false });

		const channels = await getChannels(env.my_database, 1);
		expect(channels).toHaveLength(1);
		expect(channels[0]).toMatchObject({
			channel_id: -100111,
			title: 'Channel One',
			username: 'chone',
			registered_by: 1,
			owner_id: null,
		});
	});

	it('records owner_id when the registrant is the creator', async () => {
		const result = await registerChannel(
			env.my_database,
			2,
			{ id: -100222, title: 'Channel Two', username: null },
			{ isOwner: true }
		);

		expect(result).toEqual({ isNewChannel: true, ownerAssigned: true });

		const channels = await getChannels(env.my_database, 2);
		expect(channels[0]).toMatchObject({ registered_by: 2, owner_id: 2 });
	});

	it('adds a second admin to an already-registered channel instead of duplicating it', async () => {
		await registerChannel(env.my_database, 3, { id: -100333, title: 'Shared Channel', username: null });
		const result = await registerChannel(env.my_database, 4, { id: -100333, title: 'Shared Channel', username: null });

		expect(result.isNewChannel).toBe(false);

		// هر دو کاربر باید این کانال رو توی لیست خودشون ببینن، ولی فقط یه ردیف توی channels باشه
		expect(await getChannels(env.my_database, 3)).toHaveLength(1);
		expect(await getChannels(env.my_database, 4)).toHaveLength(1);

		const { results } = await env.my_database
			.prepare('SELECT COUNT(*) as count FROM channels WHERE channel_id = ?')
			.bind(-100333)
			.all();
		expect(results[0].count).toBe(1);
	});

	it('keeps the original registrant unchanged when another admin joins later', async () => {
		await registerChannel(env.my_database, 5, { id: -100555, title: 'Channel Five', username: null });
		await registerChannel(env.my_database, 6, { id: -100555, title: 'Channel Five', username: null });

		const channels = await getChannels(env.my_database, 6);
		expect(channels[0].registered_by).toBe(5);
	});

	it('fills in owner_id retroactively once the real creator shows up, without overwriting an existing owner', async () => {
		await registerChannel(env.my_database, 5, { id: -100556, title: 'Channel Five-B', username: null });
		let result = await registerChannel(
			env.my_database,
			6,
			{ id: -100556, title: 'Channel Five-B', username: null },
			{ isOwner: true }
		);
		expect(result.ownerAssigned).toBe(true);

		let channels = await getChannels(env.my_database, 6);
		expect(channels.find((c) => c.channel_id === -100556).owner_id).toBe(6);

		// یه ادمین دیگه هم که creator باشه، نباید owner قبلی رو بازنویسی کنه
		result = await registerChannel(env.my_database, 7, { id: -100556, title: 'Channel Five-B', username: null }, { isOwner: true });
		expect(result.ownerAssigned).toBe(false);

		channels = await getChannels(env.my_database, 7);
		expect(channels.find((c) => c.channel_id === -100556).owner_id).toBe(6);
	});

	it('does not rewrite title/username when nothing has actually changed', async () => {
		await registerChannel(env.my_database, 1, { id: -100999, title: 'Stable Title', username: 'stable' });
		const before = await env.my_database.prepare('SELECT updated_at FROM channels WHERE channel_id = ?').bind(-100999).first();

		await new Promise((resolve) => setTimeout(resolve, 20));
		await registerChannel(env.my_database, 1, { id: -100999, title: 'Stable Title', username: 'stable' });

		const after = await env.my_database.prepare('SELECT updated_at FROM channels WHERE channel_id = ?').bind(-100999).first();
		expect(after.updated_at).toBe(before.updated_at);
	});

	it('updates title/username when they actually change', async () => {
		await registerChannel(env.my_database, 1, { id: -100888, title: 'Old Title', username: 'oldname' });
		await registerChannel(env.my_database, 1, { id: -100888, title: 'New Title', username: 'newname' });

		const channels = await getChannels(env.my_database, 1);
		const updated = channels.find((c) => c.channel_id === -100888);
		expect(updated.title).toBe('New Title');
		expect(updated.username).toBe('newname');
	});
});

describe('getChannels', () => {
	it('returns an empty list for a user with no channels', async () => {
		expect(await getChannels(env.my_database, 999)).toEqual([]);
	});
});

describe('removeChannelAdmin', () => {
	it("removes only that user's access, leaving the channel and other admins intact", async () => {
		await registerChannel(env.my_database, 1, { id: -100777, title: 'Removable Access', username: null });
		await registerChannel(env.my_database, 2, { id: -100777, title: 'Removable Access', username: null });

		await removeChannelAdmin(env.my_database, -100777, 2);

		expect(await getChannels(env.my_database, 2)).toEqual([]);
		expect(await getChannels(env.my_database, 1)).toHaveLength(1);
	});
});

describe('getChannelsNeedingAdminSync', () => {
	it('never-synced channels come before already-synced ones', async () => {
		await registerChannel(env.my_database, 1, { id: -300001, title: 'Never Synced', username: null });
		await syncChannelAdmins(env.my_database, -300001, [1]); // یه‌بار sync‌ش می‌کنیم
		await registerChannel(env.my_database, 1, { id: -300002, title: 'Still Never Synced', username: null });

		const batch = await getChannelsNeedingAdminSync(env.my_database, 10);
		const neverSyncedIndex = batch.findIndex((c) => c.channel_id === -300002);
		const alreadySyncedIndex = batch.findIndex((c) => c.channel_id === -300001);

		expect(neverSyncedIndex).toBeGreaterThanOrEqual(0);
		expect(alreadySyncedIndex).toBeGreaterThanOrEqual(0);
		expect(neverSyncedIndex).toBeLessThan(alreadySyncedIndex);
	});

	it('respects the batch size limit', async () => {
		for (let i = 0; i < 5; i++) {
			await registerChannel(env.my_database, 1, { id: -310000 - i, title: `Batch ${i}`, username: null });
		}

		const batch = await getChannelsNeedingAdminSync(env.my_database, 3);
		expect(batch).toHaveLength(3);
	});
});

describe('syncChannelAdmins', () => {
	it('adds admins who are known bot users and not yet linked', async () => {
		await registerChannel(env.my_database, 1, { id: -400001, title: 'Sync Target', username: null });

		const result = await syncChannelAdmins(env.my_database, -400001, [1, 2, 3]);

		expect(result.added).toBe(2); // فقط ۲ و ۳ جدید بودن؛ ۱ از قبل بود (ثبت‌کننده)
		const channels = await getChannels(env.my_database, 2);
		expect(channels.some((c) => c.channel_id === -400001)).toBe(true);
	});

	it('skips telegram admins who have never started the bot (not in users table)', async () => {
		await registerChannel(env.my_database, 1, { id: -400002, title: 'Unknown Admin', username: null });

		// 9999 توی جدول users نیست
		const result = await syncChannelAdmins(env.my_database, -400002, [1, 9999]);

		expect(result.added).toBe(0);
		expect(await getChannels(env.my_database, 9999)).toEqual([]);
	});

	it('removes admins who are no longer in the current admin list', async () => {
		await registerChannel(env.my_database, 1, { id: -400003, title: 'Demotion Test', username: null });
		await registerChannel(env.my_database, 2, { id: -400003, title: 'Demotion Test', username: null });

		// این‌بار فقط کاربر ۱ توی لیست ادمین‌های واقعیه؛ یعنی ۲ باید حذف بشه
		const result = await syncChannelAdmins(env.my_database, -400003, [1]);

		expect(result.removed).toBe(1);
		expect(await getChannels(env.my_database, 2)).toEqual([]);
		expect(await getChannels(env.my_database, 1)).toHaveLength(1);
	});

	it('always advances admins_synced_at, even when nothing changed', async () => {
		await registerChannel(env.my_database, 1, { id: -400004, title: 'No Change', username: null });

		const before = await env.my_database
			.prepare('SELECT admins_synced_at FROM channels WHERE channel_id = ?')
			.bind(-400004)
			.first();
		expect(before.admins_synced_at).toBeNull();

		const result = await syncChannelAdmins(env.my_database, -400004, [1]);

		expect(result).toEqual({ added: 0, removed: 0 });
		const after = await env.my_database
			.prepare('SELECT admins_synced_at FROM channels WHERE channel_id = ?')
			.bind(-400004)
			.first();
		expect(after.admins_synced_at).not.toBeNull();
	});

	it('handles an empty admin list without erroring', async () => {
		await registerChannel(env.my_database, 1, { id: -400005, title: 'Empty List', username: null });
		const result = await syncChannelAdmins(env.my_database, -400005, []);
		expect(result).toEqual({ added: 0, removed: 0 });
	});
});

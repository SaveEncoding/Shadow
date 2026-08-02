import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { addChannel, getChannels, deleteChannel } from '../src/telegram/db/channels.js';

beforeAll(async () => {
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, first_name TEXT NOT NULL, last_name TEXT, language_code TEXT, is_admin BOOLEAN DEFAULT FALSE, is_vip BOOLEAN DEFAULT FALSE, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));'
	);
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, channel_id INTEGER NOT NULL, title TEXT NOT NULL, username TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP), updated_at TEXT DEFAULT (CURRENT_TIMESTAMP), UNIQUE(user_id, channel_id), FOREIGN KEY (user_id) REFERENCES users(id));'
	);

	// channels.user_id has a real FOREIGN KEY constraint (D1 enforces it), so the
	// referenced users must exist first.
	for (const id of [1, 2, 3, 4, 5, 6]) {
		await env.my_database
			.prepare('INSERT INTO users (id, first_name) VALUES (?, ?)')
			.bind(id, `user-${id}`)
			.run();
	}
});

describe('channels db layer', () => {
	it('registers a new channel for a user', async () => {
		await addChannel(env.my_database, 1, { id: -100111, title: 'Channel One', username: 'chone' });

		const channels = await getChannels(env.my_database, 1);
		expect(channels).toHaveLength(1);
		expect(channels[0]).toMatchObject({ channel_id: -100111, title: 'Channel One', username: 'chone' });
	});

	it('updates title/username instead of duplicating when the same channel is forwarded again', async () => {
		await addChannel(env.my_database, 2, { id: -100222, title: 'Old Title', username: 'oldname' });
		await addChannel(env.my_database, 2, { id: -100222, title: 'New Title', username: 'newname' });

		const channels = await getChannels(env.my_database, 2);
		expect(channels).toHaveLength(1);
		expect(channels[0]).toMatchObject({ title: 'New Title', username: 'newname' });
	});

	it('keeps channels separate per user even for the same channel id', async () => {
		await addChannel(env.my_database, 3, { id: -100333, title: 'Shared Channel', username: null });
		await addChannel(env.my_database, 4, { id: -100333, title: 'Shared Channel', username: null });

		expect(await getChannels(env.my_database, 3)).toHaveLength(1);
		expect(await getChannels(env.my_database, 4)).toHaveLength(1);
	});

	it('handles a channel with no username (private channel)', async () => {
		await addChannel(env.my_database, 5, { id: -100555, title: 'Private Channel', username: null });
		const channels = await getChannels(env.my_database, 5);
		expect(channels[0].username).toBeNull();
	});

	it('removes a registered channel', async () => {
		await addChannel(env.my_database, 6, { id: -100666, title: 'Removable', username: null });
		await deleteChannel(env.my_database, 6, -100666);

		expect(await getChannels(env.my_database, 6)).toHaveLength(0);
	});

	it('returns an empty list for a user with no channels', async () => {
		expect(await getChannels(env.my_database, 999)).toEqual([]);
	});
});

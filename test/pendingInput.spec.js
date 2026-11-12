import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
	PENDING_INPUT_TTL_SECONDS,
	clearPendingInput,
	getPendingInput,
	prunePendingInputs,
	setPendingInput,
} from '../src/telegram/db/pendingInput.js';
import { channelSuffixKeyboard, channelSkipKeyboard, awaitInputKeyboard } from '../src/telegram/ui/screens.js';
import { createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';

const NOW = 1_800_000_000;

beforeAll(async () => {
	await createScheduleTables(env.my_database);
});

beforeEach(async () => {
	await resetScheduleTables(env.my_database);
});

describe('pendingInput', () => {
	it('stores, reads and clears per user in D1', async () => {
		const db = env.my_database;
		await setPendingInput(db, 42, { type: 'suffix', channelId: -1001, expiresAt: NOW + PENDING_INPUT_TTL_SECONDS });

		const pending = await getPendingInput(db, 42, NOW);
		expect(pending).toMatchObject({ type: 'suffix', channelId: -1001, promptChatId: null, promptMessageId: null });

		await clearPendingInput(db, 42);
		expect(await getPendingInput(db, 42, NOW)).toBeNull();
	});

	it('keeps prompt coordinates and overwrites the previous flow', async () => {
		const db = env.my_database;
		await setPendingInput(db, 7, { type: 'suffix', channelId: -1, promptChatId: 7, promptMessageId: 99, expiresAt: NOW + 300 });
		await setPendingInput(db, 7, { type: 'skip', channelId: -2, promptChatId: 7, promptMessageId: 100, expiresAt: NOW + 300 });

		expect(await getPendingInput(db, 7, NOW)).toEqual({
			type: 'skip',
			channelId: -2,
			promptChatId: 7,
			promptMessageId: 100,
			expiresAt: NOW + 300,
		});
	});

	it('expires and prunes like the old in-memory TTL', async () => {
		const db = env.my_database;
		await setPendingInput(db, 9, { type: 'suffix', channelId: -3, expiresAt: NOW + 60 });

		expect(await getPendingInput(db, 9, NOW + 61)).toBeNull();
		await prunePendingInputs(db, NOW + 61);
		const row = await db.prepare('SELECT COUNT(*) AS n FROM ui_pending_inputs').first();
		expect(Number(row.n)).toBe(0);
	});

	it('is visible across "isolates", i.e. it is not held in module memory', async () => {
		// همان چیزی که این انتقال را لازم کرد: ردیف باید در D1 باشد، نه در Map.
		await setPendingInput(env.my_database, 11, { type: 'suffix', channelId: -4, expiresAt: NOW + 300 });
		const row = await env.my_database.prepare('SELECT user_id FROM ui_pending_inputs WHERE user_id = ?').bind(11).first();
		expect(Number(row.user_id)).toBe(11);
	});
});

describe('suffix glass keyboards', () => {
	it('includes set/clear callbacks', () => {
		const rows = channelSuffixKeyboard(-100123)
			.inline_keyboard.flat()
			.map((b) => b.callback_data);
		expect(rows).toContain('m:cs:set:-100123');
		expect(rows).toContain('m:cs:clr:-100123');
	});

	it('await keyboard can cancel', () => {
		const rows = awaitInputKeyboard(-100123, 'suffix')
			.inline_keyboard.flat()
			.map((b) => b.callback_data);
		expect(rows).toContain('m:cs:x:-100123');
	});

	it('skip keyboard includes set callback', () => {
		const rows = channelSkipKeyboard(-9)
			.inline_keyboard.flat()
			.map((b) => b.callback_data);
		expect(rows).toContain('m:sk:set:-9');
	});
});

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { publishDuePosts } from '../src/telegram/publishQueue.js';
import { appendItem, createQueuedPost, finalizePost } from '../src/telegram/db/postQueue.js';
import { CHANNELS_TABLE, createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';
import { countingDb } from './helpers/countingDb.js';

/**
 * اندازه‌گیری تیک کرون.
 *
 * Cloudflare تعداد کوئری‌های D1 هر invocation را گزارش نمی‌کند، پس خودمان
 * می‌شماریم و در یک خط JSON لاگ می‌کنیم. این تست دو چیز را تضمین می‌کند:
 *   ۱. عددی که لاگ می‌شود همان تعداد واقعی statement است (با یک شمارنده‌ی
 *      مستقل روی همان D1 مقایسه می‌شود)،
 *   ۲. شکل خط لاگ ثابت می‌ماند، چون داشبورد و کوئری‌های Workers Logs به همان
 *      نام فیلدها تکیه می‌کنند.
 */

const NOW = 1_800_000_060;
const TARGET = -1001234567890;

const api = new Proxy({}, { get: () => async () => ({ message_id: 1 }) });

const textItem = (id, text) => ({ sourceMessageId: id, kind: 'text', fileId: null, text, entities: null, extra: null });

/** تیک را با یک شمارنده‌ی مستقل اجرا می‌کند */
async function tick(now = NOW) {
	const { db, counter } = countingDb(env.my_database);
	const result = await publishDuePosts(
		{ ...env, my_database: db },
		{ api, now, fetchImpl: async () => new Response('{}', { status: 404 }) },
	);
	return { result, counter };
}

beforeAll(async () => {
	await createScheduleTables(env.my_database);
	await env.my_database.exec(CHANNELS_TABLE);
});

beforeEach(async () => {
	await resetScheduleTables(env.my_database);
	await env.my_database.exec('DELETE FROM channels;');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('tick metrics', () => {
	it('reports the same statement count as an independent counter', async () => {
		const { result, counter } = await tick();

		expect(result.metrics.queries).toBe(counter.total);
		expect(result.metrics.roundTrips).toBe(counter.roundTrips);
	});

	it('counts a batch as several statements but one round trip', async () => {
		const { result } = await tick();

		// listReadyPosts دو SELECT در یک batch است: statement بیشتر از round trip
		expect(result.metrics.queries).toBeGreaterThan(result.metrics.roundTrips);
	});

	it('grows when a post is actually published', async () => {
		const idle = await tick();

		const id = await createQueuedPost(env.my_database, {
			sourceChannelId: -100,
			targetChannelId: TARGET,
			mediaGroupId: null,
			createdBy: 5,
			now: NOW,
		});
		await appendItem(env.my_database, id, textItem(1, 'سلام'), NOW);
		await finalizePost(env.my_database, id, NOW - 5, NOW);

		const busy = await tick();
		expect(busy.result.published).toBe(1);
		expect(busy.result.metrics.queries).toBeGreaterThan(idle.result.metrics.queries);
	});

	it('logs one structured line with the measured numbers', async () => {
		const logs = [];
		vi.spyOn(console, 'log').mockImplementation((line) => logs.push(line));

		const { result } = await tick();

		const line = logs.find((entry) => entry && typeof entry === 'object' && entry.event === 'cron.publish');
		expect(line).toBeTruthy();
		expect(line.now).toBe(NOW);
		expect(line.dbQueries).toBe(result.metrics.queries);
		expect(line.dbRoundTrips).toBe(result.metrics.roundTrips);
		expect(line.durationMs).toBeGreaterThanOrEqual(0);
		expect(line).toMatchObject({ finalized: 0, published: 0, failed: 0, polled: 0, queued: 0 });
	});
});

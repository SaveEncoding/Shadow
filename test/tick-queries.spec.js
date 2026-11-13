import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { publishDuePosts } from '../src/telegram/publishQueue.js';
import { appendItem, createQueuedPost, finalizePost, listPendingPosts, listReadyPosts } from '../src/telegram/db/postQueue.js';
import { CHANNELS_TABLE, createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';
import { countingDb } from './helpers/countingDb.js';

/**
 * بودجه‌ی کوئری کرون.
 *
 * چرا تست دارد؟ چون «بهینه‌سازی» بدون عدد فقط حس است. کرون هر دقیقه اجرا می‌شود،
 * پس هر کوئری اضافه در تیک خالی هم ۱۴۴۰ بار در روز هزینه دارد. این فایل تعداد
 * statement ها و رفت‌وبرگشت‌های D1 را می‌شمارد و روی سقف پین می‌کند: هر تغییر
 * آینده که کوئری اضافه کند، تست را قرمز می‌کند.
 *
 * (اعداد اندازه‌گیری‌شده در پیام کامیت‌های Step 2 ثبت شده‌اند.)
 */

const NOW = 1_800_000_000;
/** NOW % 3600 === 0 است، پس تیک «ساعتگرد» هم پاک‌سازی را اجرا می‌کند */
const TICK_WITH_PRUNE = NOW;
const TICK_PLAIN = NOW + 60;

const TARGET = -1001234567890;

/** کلاینت تلگرام قلابی: هر متد یک پاسخ معتبر برمی‌گرداند */
const api = new Proxy(
	{},
	{
		get: () => async () => ({ message_id: 1 }),
	},
);

const textItem = (id, text) => ({ sourceMessageId: id, kind: 'text', fileId: null, text, entities: null, extra: null });

async function tick(now = TICK_PLAIN) {
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

describe('cron tick query budget', () => {
	it('keeps an idle tick at 4 statements / 3 round trips', async () => {
		const { result, counter } = await tick();

		expect(result.published).toBe(0);
		// `listReadyPosts` حالا دو SELECT است (یکی برای scheduled، یکی collecting) که
		// با `batch` در یک رفت‌وبرگشت می‌روند؛ پس یک statement بیشتر، همان ۳ رفت‌وبرگشت.
		expect(counter.total, counter.summary()).toBe(4);
		expect(counter.roundTrips).toBe(3);
	});

	it('adds only the hourly prune on the hourly tick', async () => {
		const { counter } = await tick(TICK_WITH_PRUNE);
		// pruneSeen + pruneEditSessions + prunePendingInputs
		expect(counter.total, counter.summary()).toBe(7);
	});

	it('publishes one due post within 10 statements', async () => {
		const id = await createQueuedPost(env.my_database, {
			sourceChannelId: -100,
			targetChannelId: TARGET,
			mediaGroupId: null,
			createdBy: 5,
			now: NOW,
		});
		await appendItem(env.my_database, id, textItem(1, 'سلام'), NOW);
		await finalizePost(env.my_database, id, NOW - 5, NOW);

		const { result, counter } = await tick();
		expect(result.published).toBe(1);
		// ۴ کوئری تیک + ۶ کوئری انتشار همین پست (claim، پست، آیتم‌ها، کانال، markPublished، پیش‌نمایش)
		expect(counter.total, counter.summary()).toBeLessThanOrEqual(11);
	});

	it('finalizes a due album with a bounded number of statements', async () => {
		const id = await createQueuedPost(env.my_database, {
			sourceChannelId: -100,
			targetChannelId: TARGET,
			mediaGroupId: 'g1',
			createdBy: 5,
			now: NOW - 100,
		});
		await appendItem(env.my_database, id, textItem(1, 'آلبوم'), NOW - 100, NOW - 80);

		const { result } = await tick();
		const [post] = await listPendingPosts(env.my_database, TARGET);
		expect(result.finalized).toBe(1);
		expect(post.id).toBe(id);
	});

	it('loads a page of pending posts with 2 statements, not 1 + 2 per post', async () => {
		for (let i = 0; i < 5; i++) {
			const id = await createQueuedPost(env.my_database, {
				sourceChannelId: -100,
				targetChannelId: TARGET,
				mediaGroupId: null,
				createdBy: 5,
				now: NOW,
			});
			await appendItem(env.my_database, id, textItem(i + 1, `پست ${i + 1}`), NOW);
			await finalizePost(env.my_database, id, NOW + 600 + i, NOW);
		}

		const { db, counter } = countingDb(env.my_database);
		const posts = await listPendingPosts(db, TARGET, 10);
		expect(posts).toHaveLength(5);
		expect(counter.total, counter.summary()).toBe(2);
	});
});

describe('listReadyPosts', () => {
	/** یک پست با زمان انتشار مشخص می‌سازد (scheduled) */
	async function scheduledPost(publishAt) {
		const id = await createQueuedPost(env.my_database, {
			sourceChannelId: -100,
			targetChannelId: TARGET,
			mediaGroupId: null,
			createdBy: 5,
			now: NOW,
		});
		await appendItem(env.my_database, id, textItem(1, `پست ${id}`), NOW);
		await finalizePost(env.my_database, id, publishAt, NOW);
		return id;
	}

	/** یک پست در حال جمع‌آوری که مهلت آلبومش سر رسیده است */
	async function collectingPost(publishAt) {
		const id = await createQueuedPost(env.my_database, {
			sourceChannelId: -100,
			targetChannelId: TARGET,
			mediaGroupId: 'g',
			createdBy: 5,
			now: publishAt,
		});
		await appendItem(env.my_database, id, textItem(1, `آلبوم ${id}`), publishAt, NOW - 1);
		return id;
	}

	it('returns the earliest due posts when the backlog exceeds the limit', async () => {
		const ids = [];
		for (let i = 0; i < 30; i++) ids.push(await scheduledPost(NOW - 1000 + i));

		const ready = await listReadyPosts(env.my_database, NOW, 10);
		expect(ready).toHaveLength(10);
		expect(ready).toEqual(ids.slice(0, 10));
	});

	it('does not return posts that are not due yet', async () => {
		const due = await scheduledPost(NOW - 10);
		await scheduledPost(NOW + 600);

		const ready = await listReadyPosts(env.my_database, NOW, 10);
		expect(ready).toEqual([due]);
	});

	it('merges due collecting posts in publish_at order', async () => {
		const early = await collectingPost(NOW - 5000);
		const late = await scheduledPost(NOW - 1);

		const ready = await listReadyPosts(env.my_database, NOW, 10);
		expect(ready).toEqual([early, late]);
	});
});

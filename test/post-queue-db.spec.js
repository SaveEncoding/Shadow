import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
	appendItem,
	cancelPost,
	claimForPublish,
	clearCaptureSession,
	clearEditSession,
	countPendingPosts,
	createQueuedPost,
	deleteSourceRule,
	finalizePost,
	findCaptureSession,
	findCollectingPost,
	findEditSession,
	findItemBySourceMessage,
	getLastPublished,
	getPost,
	getSourceRule,
	listPendingPosts,
	listReadyPosts,
	listRulesForTarget,
	listStuckPosts,
	markFailed,
	markMessageSeen,
	markPublished,
	pruneEditSessions,
	pruneSeen,
	reschedulePost,
	saveSourceRule,
	setPreviewMessage,
	setRuleDelay,
	setRuleEnabled,
	startCaptureSession,
	startEditSession,
	updateItemContent,
} from '../src/telegram/db/postQueue.js';

import { createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';

const NOW = 1_800_000_000;
const TARGET = -1001234567890;
const SOURCE = -1009876543210;

const textItem = (id, text, entities = null) => ({
	sourceMessageId: id,
	kind: 'text',
	fileId: null,
	text,
	entities,
	extra: null,
});

const photoItem = (id, fileId, caption = null) => ({
	sourceMessageId: id,
	kind: 'photo',
	fileId,
	text: caption,
	entities: null,
	extra: { width: 1280, height: 720 },
});

beforeAll(async () => {
	await createScheduleTables(env.my_database);
});

beforeEach(async () => {
	await resetScheduleTables(env.my_database);
});

async function makeRule(overrides = {}) {
	await saveSourceRule(env.my_database, {
		sourceChannelId: SOURCE,
		sourceTitle: 'کانال مبدأ',
		sourceUsername: 'source_chan',
		targetChannelId: TARGET,
		delayMinutes: 30,
		enabled: true,
		notifyChatId: 555,
		addedBy: 7,
		now: NOW,
		...overrides,
	});
	return getSourceRule(env.my_database, overrides.sourceChannelId ?? SOURCE);
}

async function makeScheduledPost(text = 'سلام', publishAt = NOW - 10) {
	const db = env.my_database;
	const id = await createQueuedPost(db, {
		sourceChannelId: SOURCE,
		sourceTitle: 'کانال مبدأ',
		sourceUsername: 'source_chan',
		targetChannelId: TARGET,
		mediaGroupId: null,
		createdBy: 555,
		now: NOW,
	});
	await appendItem(db, id, textItem(1, text), NOW);
	await finalizePost(db, id, publishAt, NOW);
	return id;
}

describe('source rules', () => {
	it('saves a rule and upserts it on the same source channel', async () => {
		const rule = await makeRule();
		expect(rule.sourceChannelId).toBe(SOURCE);
		expect(rule.targetChannelId).toBe(TARGET);
		expect(rule.delayMinutes).toBe(30);
		expect(rule.enabled).toBe(true);
		expect(rule.sourceTitle).toBe('کانال مبدأ');
		expect(rule.sourceUsername).toBe('source_chan');
		expect(rule.notifyChatId).toBe(555);

		const updated = await makeRule({ delayMinutes: 120, targetChannelId: -100999 });
		expect(updated.id).toBe(rule.id);
		expect(updated.delayMinutes).toBe(120);
		expect(updated.targetChannelId).toBe(-100999);

		const list = await listRulesForTarget(env.my_database, -100999);
		expect(list).toHaveLength(1);
	});

	it('toggles, slows down and deletes a rule', async () => {
		const rule = await makeRule();

		await setRuleEnabled(env.my_database, SOURCE, false, NOW);
		expect((await getSourceRule(env.my_database, SOURCE)).enabled).toBe(false);

		await setRuleDelay(env.my_database, SOURCE, 180, NOW);
		expect((await getSourceRule(env.my_database, SOURCE)).delayMinutes).toBe(180);

		await deleteSourceRule(env.my_database, SOURCE);
		expect(await getSourceRule(env.my_database, SOURCE)).toBeNull();
		expect(rule.id).toBeGreaterThan(0);
	});
});

describe('capture and queue', () => {
	it('deduplicates the same source message (webhook retries)', async () => {
		expect(await markMessageSeen(env.my_database, SOURCE, 42, NOW)).toBe(true);
		expect(await markMessageSeen(env.my_database, SOURCE, 42, NOW)).toBe(false);
		// همان شماره‌ی پیام در کانال دیگر، پیام دیگری است
		expect(await markMessageSeen(env.my_database, -100777, 42, NOW)).toBe(true);
	});

	it('collects album items into one post and finalizes it with the publish time', async () => {
		const db = env.my_database;
		const id = await createQueuedPost(db, {
			sourceChannelId: SOURCE,
			targetChannelId: TARGET,
			mediaGroupId: 'grp-1',
			createdBy: 555,
			now: NOW,
		});

		expect(await findCollectingPost(db, SOURCE, 'grp-1')).toBe(id);
		expect(await findCollectingPost(db, SOURCE, 'grp-2')).toBeNull();

		const finalizeAt = NOW + 20;
		expect(await appendItem(db, id, photoItem(10, 'file-a'), NOW, finalizeAt)).toBe(true);
		expect(await appendItem(db, id, photoItem(11, 'file-b'), NOW, finalizeAt)).toBe(true);
		// آیتم تکراری نادیده گرفته می‌شود
		expect(await appendItem(db, id, photoItem(11, 'file-b'), NOW, finalizeAt)).toBe(false);

		let post = await getPost(db, id);
		expect(post.status).toBe('collecting');
		expect(post.items).toHaveLength(2);
		expect(post.finalizeAt).toBe(finalizeAt);
		expect(post.publishAt).toBe(0);

		// پیش از پایان مهلت، آماده نیست
		expect(await listReadyPosts(db, NOW, 10)).toHaveLength(0);
		expect(await listReadyPosts(db, finalizeAt, 10)).toEqual([id]);

		expect(await finalizePost(db, id, NOW + 1800, NOW)).toBe(true);
		post = await getPost(db, id);
		expect(post.status).toBe('scheduled');
		expect(post.publishAt).toBe(NOW + 1800);
		expect(post.finalizeAt).toBeNull();
		expect(post.items.map((i) => i.sourceMessageId)).toEqual([10, 11]);
	});

	it('deletes an empty post instead of queueing a zombie', async () => {
		const db = env.my_database;
		const id = await createQueuedPost(db, {
			sourceChannelId: SOURCE,
			targetChannelId: TARGET,
			mediaGroupId: null,
			createdBy: 555,
			now: NOW,
		});
		expect(await finalizePost(db, id, NOW + 60, NOW)).toBe(false);
		expect(await getPost(db, id)).toBeNull();
	});

	it('keeps entities and extra metadata through the round trip', async () => {
		const db = env.my_database;
		const id = await createQueuedPost(db, {
			sourceChannelId: SOURCE,
			targetChannelId: TARGET,
			mediaGroupId: null,
			createdBy: 555,
			now: NOW,
		});
		const entities = [{ type: 'bold', offset: 0, length: 3 }];
		await appendItem(db, id, { ...photoItem(5, 'file-x', 'کپشن'), entities }, NOW);
		const post = await getPost(db, id);
		expect(post.items[0].entities).toEqual(entities);
		expect(post.items[0].extra).toEqual({ width: 1280, height: 720 });
		expect(post.items[0].fileId).toBe('file-x');
	});

	it('lists only pending posts of the target channel', async () => {
		const db = env.my_database;
		const scheduled = await makeScheduledPost('یکی', NOW + 600);
		const published = await makeScheduledPost('دو', NOW - 5);
		expect(await claimForPublish(db, published, NOW)).toBe(true);
		await markPublished(db, published, 999, NOW);

		const pending = await listPendingPosts(db, TARGET);
		expect(pending.map((p) => p.id)).toEqual([scheduled]);
		expect(await countPendingPosts(db, TARGET)).toBe(1);
		expect(await countPendingPosts(db, -100555)).toBe(0);

		const last = await getLastPublished(db, TARGET);
		expect(last.id).toBe(published);
		expect(last.publishedMessageId).toBe(999);
	});
});

describe('publishing guards', () => {
	it('claims a post exactly once', async () => {
		const db = env.my_database;
		const id = await makeScheduledPost();

		expect(await listReadyPosts(db, NOW, 10)).toEqual([id]);
		expect(await claimForPublish(db, id, NOW)).toBe(true);
		// تلاش دوم (کلیک دوباره یا تیک دوم کرون) نباید دوباره ارسال کند
		expect(await claimForPublish(db, id, NOW)).toBe(false);
		expect(await listReadyPosts(db, NOW, 10)).toHaveLength(0);

		await markPublished(db, id, 77, NOW);
		const post = await getPost(db, id);
		expect(post.status).toBe('published');
		expect(post.publishedMessageId).toBe(77);
		expect(post.publishedAt).toBe(NOW);
	});

	it('schedules a retry and then gives up after the last attempt', async () => {
		const db = env.my_database;
		const id = await makeScheduledPost();

		await claimForPublish(db, id, NOW);
		await markFailed(db, id, 'قطعی شبکه', NOW, NOW + 180, 1);
		let post = await getPost(db, id);
		expect(post.status).toBe('scheduled');
		expect(post.attempts).toBe(1);
		expect(post.publishAt).toBe(NOW + 180);
		expect(post.lastError).toBe('قطعی شبکه');

		await claimForPublish(db, id, NOW + 180);
		await markFailed(db, id, 'باز هم خطا', NOW + 180, null, 2);
		post = await getPost(db, id);
		expect(post.status).toBe('failed');
		expect(post.lastError).toBe('باز هم خطا');
		expect(await listReadyPosts(db, NOW + 10_000, 10)).toHaveLength(0);
	});

	it('finds posts stuck in publishing (Worker died mid-send)', async () => {
		const db = env.my_database;
		const id = await makeScheduledPost();
		await claimForPublish(db, id, NOW);

		expect(await listStuckPosts(db, NOW + 60, 600)).toHaveLength(0);
		expect(await listStuckPosts(db, NOW + 601, 600)).toEqual([id]);
	});

	it('cancels and reschedules only active posts', async () => {
		const db = env.my_database;
		const id = await makeScheduledPost('سلام', NOW + 600);

		await reschedulePost(db, id, NOW + 3600, NOW);
		expect((await getPost(db, id)).publishAt).toBe(NOW + 3600);

		await cancelPost(db, id, NOW);
		expect((await getPost(db, id)).status).toBe('canceled');

		// پست لغوشده دیگر با «انتشار الان» هم فرستاده نمی‌شود
		expect(await claimForPublish(db, id, NOW)).toBe(false);
	});

	it('edits an item and flags the post as edited', async () => {
		const db = env.my_database;
		const id = await makeScheduledPost('متن اصلی');

		await updateItemContent(db, id, 1, { text: 'متن ویرایش‌شده', entities: [{ type: 'bold', offset: 0, length: 4 }] }, NOW);

		const post = await getPost(db, id);
		expect(post.items[0].text).toBe('متن ویرایش‌شده');
		expect(post.items[0].entities).toEqual([{ type: 'bold', offset: 0, length: 4 }]);
		expect(post.edited).toBe(true);
	});

	it('finds the queued item behind a source message (source edits)', async () => {
		const db = env.my_database;
		const id = await makeScheduledPost('متن اصلی');

		const found = await findItemBySourceMessage(db, SOURCE, 1);
		expect(found.post.id).toBe(id);
		expect(found.item.text).toBe('متن اصلی');
		expect(await findItemBySourceMessage(db, SOURCE, 999)).toBeNull();
	});

	it('stores the preview message so it can be edited in place later', async () => {
		const db = env.my_database;
		const id = await makeScheduledPost();
		await setPreviewMessage(db, id, 555, 9001);

		const post = await getPost(db, id);
		expect(post.previewChatId).toBe(555);
		expect(post.previewMessageId).toBe(9001);
	});
});

describe('sessions and cleanup', () => {
	it('upserts an edit session per user and expires it', async () => {
		const db = env.my_database;
		const input = {
			postId: 5,
			userId: 42,
			chatId: 42,
			messageId: 1,
			field: 'text',
			targetMessageId: 10,
			expiresAt: NOW + 900,
		};

		await startEditSession(db, { ...input, postId: 5 });
		await startEditSession(db, { ...input, postId: 6, field: 'caption' });

		const session = await findEditSession(db, 42, NOW);
		expect(session.postId).toBe(6);
		expect(session.field).toBe('caption');
		expect(session.targetMessageId).toBe(10);

		expect(await findEditSession(db, 42, NOW + 901)).toBeNull();

		await pruneEditSessions(db, NOW + 901);
		expect(await findEditSession(db, 42, NOW)).toBeNull();
	});

	it('expires capture sessions', async () => {
		const db = env.my_database;
		await startCaptureSession(db, {
			userId: 42,
			targetChannelId: TARGET,
			mode: 'source',
			delayMinutes: 45,
			expiresAt: NOW + 900,
		});

		const session = await findCaptureSession(db, 42, NOW);
		expect(session).toEqual({ targetChannelId: TARGET, mode: 'source', delayMinutes: 45, expiresAt: NOW + 900 });
		expect(await findCaptureSession(db, 42, NOW + 901)).toBeNull();

		await clearCaptureSession(db, 42);
		expect(await findCaptureSession(db, 42, NOW)).toBeNull();
	});

	it('clears edit sessions', async () => {
		const db = env.my_database;
		await startEditSession(db, {
			postId: 1,
			userId: 42,
			chatId: 42,
			messageId: 1,
			field: 'text',
			targetMessageId: 1,
			expiresAt: NOW + 900,
		});
		await clearEditSession(db, 42);
		expect(await findEditSession(db, 42, NOW)).toBeNull();
	});

	it('prunes old seen records only', async () => {
		const db = env.my_database;
		await markMessageSeen(db, SOURCE, 1, NOW - 10_000);
		await markMessageSeen(db, SOURCE, 2, NOW);

		await pruneSeen(db, NOW - 1);
		expect(await markMessageSeen(db, SOURCE, 1, NOW + 1)).toBe(true); // قدیمی پاک شد
		expect(await markMessageSeen(db, SOURCE, 2, NOW + 1)).toBe(false); // تازه ماند
	});
});

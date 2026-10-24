import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
	applySourceEdit,
	captureSourcePost,
	extractPostItem,
	isSendableKind,
	queueManualPost,
	unsupportedReason,
} from '../src/telegram/capturePost.js';
import { getPost, getSourceRule, saveSourceRule, setRuleEnabled } from '../src/telegram/db/postQueue.js';
import { createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';

const NOW = 1_800_000_000;
const SOURCE = -1009876543210;
const TARGET = -1001234567890;

const channelPost = (overrides = {}) => ({
	message_id: 101,
	chat: { id: SOURCE, type: 'channel', title: 'کانال مبدأ', username: 'source_chan' },
	date: NOW,
	text: 'سلام دنیا',
	...overrides,
});

async function addRule(overrides = {}) {
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
}

beforeAll(async () => {
	await createScheduleTables(env.my_database);
});

beforeEach(async () => {
	await resetScheduleTables(env.my_database);
});

describe('extractPostItem', () => {
	it('keeps text and entities', () => {
		const entities = [{ type: 'bold', offset: 0, length: 4 }];
		const item = extractPostItem(channelPost({ entities }));
		expect(item).toMatchObject({ kind: 'text', text: 'سلام دنیا', entities, fileId: null });
	});

	it('picks the largest photo and its caption', () => {
		const item = extractPostItem(
			channelPost({
				text: undefined,
				photo: [
					{ file_id: 'small', width: 90, height: 90 },
					{ file_id: 'big', width: 1280, height: 1280 },
				],
				caption: 'کپشن',
				caption_entities: [{ type: 'bold', offset: 0, length: 4 }],
			}),
		);
		expect(item.kind).toBe('photo');
		expect(item.fileId).toBe('big');
		expect(item.text).toBe('کپشن');
		expect(item.extra).toEqual({ width: 1280, height: 1280 });
	});

	it('extracts video, animation, document, audio, voice and sticker', () => {
		const cases = [
			[{ video: { file_id: 'v', width: 720, height: 1280, duration: 5 } }, 'video'],
			[{ animation: { file_id: 'a', width: 1, height: 2, duration: 3 } }, 'animation'],
			[{ document: { file_id: 'd', file_name: 'x.pdf' } }, 'document'],
			[{ audio: { file_id: 'au', duration: 10, title: 't' } }, 'audio'],
			[{ voice: { file_id: 'vo', duration: 2 } }, 'voice'],
			[{ sticker: { file_id: 's' } }, 'sticker'],
		];
		for (const [extra, kind] of cases) {
			const item = extractPostItem(channelPost({ text: undefined, ...extra }));
			expect(item?.kind).toBe(kind);
		}
	});

	it('returns null for an empty message', () => {
		expect(extractPostItem(channelPost({ text: undefined }))).toBeNull();
		expect(extractPostItem(channelPost({ text: '   ' }))).toBeNull();
	});
});

describe('unsupportedReason', () => {
	it('names content we cannot resend (v1)', () => {
		expect(unsupportedReason(channelPost({ poll: {} }))).toContain('نظرسنجی');
		expect(unsupportedReason(channelPost({ location: {} }))).toContain('موقعیت');
		expect(unsupportedReason(channelPost({ contact: {} }))).toContain('مخاطب');
		expect(unsupportedReason(channelPost({ dice: {} }))).toContain('تاس');
		expect(unsupportedReason(channelPost({ game: {} }))).toContain('بازی');
	});

	it('passes normal posts', () => {
		expect(unsupportedReason(channelPost())).toBeNull();
		expect(isSendableKind('photo')).toBe(true);
		expect(isSendableKind('unsupported')).toBe(false);
	});
});

describe('captureSourcePost', () => {
	it('ignores channels without an enabled rule', async () => {
		expect(await captureSourcePost(env.my_database, channelPost(), NOW)).toEqual({ action: 'no-rule' });

		// ثبت دوباره‌ی قانون همیشه آن را روشن می‌کند؛ برای خاموش‌کردن از این استفاده می‌شود
		await addRule({ sourceChannelId: -100777 });
		await addRule();
		await setRuleEnabled(env.my_database, SOURCE, false, NOW);
		expect(await captureSourcePost(env.my_database, channelPost(), NOW)).toEqual({ action: 'no-rule' });
	});

	it('queues a text post with the rule delay and notifies the rule owner', async () => {
		await addRule();
		const outcome = await captureSourcePost(env.my_database, channelPost(), NOW);

		expect(outcome.action).toBe('queued');
		expect(outcome.publishAt).toBe(NOW + 30 * 60);

		const post = await getPost(env.my_database, outcome.postId);
		expect(post.status).toBe('scheduled');
		expect(post.targetChannelId).toBe(TARGET);
		expect(post.sourceTitle).toBe('کانال مبدأ');
		expect(post.createdBy).toBe(555); // چت خصوصی سازنده‌ی قانون
		expect(post.items).toHaveLength(1);
		expect(post.items[0].text).toBe('سلام دنیا');
	});

	it('applies the delay of the rule, not a global default', async () => {
		await addRule({ delayMinutes: 5 });
		const outcome = await captureSourcePost(env.my_database, channelPost(), NOW);
		expect(outcome.publishAt).toBe(NOW + 300);
	});

	it('deduplicates a webhook retry of the same message', async () => {
		await addRule();
		const first = await captureSourcePost(env.my_database, channelPost(), NOW);
		const second = await captureSourcePost(env.my_database, channelPost(), NOW);

		expect(first.action).toBe('queued');
		expect(second).toEqual({ action: 'duplicate' });
	});

	it('collects album items into a single post', async () => {
		await addRule();
		const album = { media_group_id: 'alb-1' };

		const a = await captureSourcePost(
			env.my_database,
			channelPost({ ...album, message_id: 1, text: undefined, photo: [{ file_id: 'a', width: 1, height: 1 }] }),
			NOW,
		);
		const b = await captureSourcePost(
			env.my_database,
			channelPost({ ...album, message_id: 2, text: undefined, photo: [{ file_id: 'b', width: 1, height: 1 }] }),
			NOW + 2,
		);

		expect(a.action).toBe('collecting');
		expect(b.action).toBe('collecting');
		expect(b.postId).toBe(a.postId);

		const post = await getPost(env.my_database, a.postId);
		expect(post.status).toBe('collecting');
		expect(post.items.map((i) => i.fileId)).toEqual(['a', 'b']);
		expect(post.finalizeAt).toBe(NOW + 2 + 20); // مهلت پایان جمع‌آوری
	});

	it('skips unsupported content without queueing anything', async () => {
		await addRule();
		const outcome = await captureSourcePost(env.my_database, channelPost({ text: undefined, poll: {} }), NOW);
		expect(outcome.action).toBe('unsupported');
		// پیام «دیده‌شده» ثبت نمی‌شود تا اگر بعداً پشتیبانی شد، از دست نرود
		const again = await captureSourcePost(env.my_database, channelPost({ text: 'متن' }), NOW);
		expect(again.action).toBe('queued');
	});

	it('respects a rule that points at another target channel', async () => {
		await addRule({ targetChannelId: -100777 });
		const outcome = await captureSourcePost(env.my_database, channelPost(), NOW);
		expect((await getPost(env.my_database, outcome.postId)).targetChannelId).toBe(-100777);
	});
});

describe('applySourceEdit', () => {
	it('updates the queued post while it is still waiting', async () => {
		await addRule();
		const { postId } = await captureSourcePost(env.my_database, channelPost(), NOW);

		const outcome = await applySourceEdit(
			env.my_database,
			channelPost({ text: 'متن اصلاح‌شده', entities: [{ type: 'bold', offset: 0, length: 4 }] }),
			NOW + 60,
		);

		expect(outcome).toMatchObject({ action: 'updated', postId, published: false, text: 'متن اصلاح‌شده' });
		const post = await getPost(env.my_database, postId);
		expect(post.items[0].text).toBe('متن اصلاح‌شده');
		expect(post.items[0].entities).toEqual([{ type: 'bold', offset: 0, length: 4 }]);
		expect(post.edited).toBe(true);
	});

	it('ignores edits for messages we never captured', async () => {
		await addRule();
		expect(await applySourceEdit(env.my_database, channelPost({ message_id: 999 }), NOW)).toEqual({ action: 'ignored' });
	});

	it('updates the caption of a media post', async () => {
		await addRule();
		const { postId } = await captureSourcePost(
			env.my_database,
			channelPost({ text: undefined, photo: [{ file_id: 'p', width: 1, height: 1 }], caption: 'قبلی' }),
			NOW,
		);

		await applySourceEdit(
			env.my_database,
			channelPost({ text: undefined, photo: [{ file_id: 'p', width: 1, height: 1 }], caption: 'کپشن تازه' }),
			NOW + 10,
		);

		expect((await getPost(env.my_database, postId)).items[0].text).toBe('کپشن تازه');
	});
});

describe('queueManualPost', () => {
	it('queues a forwarded post that has no source channel', async () => {
		const result = await queueManualPost(
			env.my_database,
			[{ sourceMessageId: 1, kind: 'text', fileId: null, text: 'پست دستی', entities: null, extra: null }],
			{ targetChannelId: TARGET, delayMinutes: 15, createdBy: 42, now: NOW },
		);

		expect(result.publishAt).toBe(NOW + 900);
		const post = await getPost(env.my_database, result.postId);
		expect(post.sourceChannelId).toBe(0);
		expect(post.status).toBe('scheduled');
		expect(post.createdBy).toBe(42);
	});

	it('refuses an empty post', async () => {
		expect(
			await queueManualPost(env.my_database, [], {
				targetChannelId: TARGET,
				delayMinutes: 15,
				createdBy: 42,
				now: NOW,
			}),
		).toBeNull();
	});

	it('does not create a rule (manual posts are one-off)', async () => {
		await queueManualPost(
			env.my_database,
			[{ sourceMessageId: 1, kind: 'text', fileId: null, text: 'x', entities: null, extra: null }],
			{ targetChannelId: TARGET, delayMinutes: 15, createdBy: 42, now: NOW },
		);
		expect(await getSourceRule(env.my_database, 0)).toBeNull();
	});
});

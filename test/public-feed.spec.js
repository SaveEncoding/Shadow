import { describe, it, expect } from 'vitest';
import {
	isValidChannelUsername,
	latestMessageId,
	maxFeedMedia,
	normalizeUsername,
	parsePublicFeed,
	publicSourceChannelId,
} from '../src/core/schedule/publicFeed.js';
import { fetchPublicFeed, publicFeedUrl } from '../src/telegram/publicFeed.js';
import { EMPTY_PAGE, feedPage } from './helpers/feedFixture.js';

const CHANNEL = 'shadow_news';

const page = () =>
	feedPage([
		{ channel: CHANNEL, id: 100, html: 'پست <b>اول</b>' },
		{ channel: CHANNEL, id: 101, html: 'پست دوم', media: [{ kind: 'photo', url: 'https://cdn.example/a.jpg' }] },
		{
			channel: CHANNEL,
			id: 102,
			media: [
				{ kind: 'photo', url: 'https://cdn.example/b.jpg' },
				{ kind: 'photo', url: 'https://cdn.example/c.jpg' },
			],
			html: 'آلبوم',
		},
		{
			channel: CHANNEL,
			id: 103,
			media: [{ kind: 'video', url: 'https://cdn.example/v.mp4', thumb: 'https://cdn.example/v.jpg' }],
			html: 'ویدیو',
		},
		{
			channel: CHANNEL,
			id: 104,
			extraHtml: '<div class="tgme_widget_message_poll"><div class="tgme_widget_message_poll_question">نظرسنجی</div></div>',
		},
		{ channel: CHANNEL, id: 105, extraHtml: '<div class="tgme_widget_message_document">file.pdf</div>' },
	]);

describe('parsePublicFeed', () => {
	it('reads every post of the page in order', () => {
		const posts = parsePublicFeed(page(), CHANNEL);
		expect(posts.map((p) => p.messageId)).toEqual([100, 101, 102, 103, 104, 105]);
	});

	it('keeps text formatting as entities', () => {
		const [first] = parsePublicFeed(page(), CHANNEL);
		expect(first.text).toBe('پست اول');
		expect(first.entities).toEqual([{ type: 'bold', offset: 4, length: 3 }]);
	});

	it('extracts single photos and albums', () => {
		const posts = parsePublicFeed(page(), CHANNEL);
		expect(posts[1].media).toEqual([{ kind: 'photo', url: 'https://cdn.example/a.jpg' }]);
		expect(posts[2].media).toHaveLength(2);
		expect(posts[2].text).toBe('آلبوم');
	});

	it('extracts a direct video url (not the thumbnail)', () => {
		const posts = parsePublicFeed(page(), CHANNEL);
		expect(posts[3].media).toEqual([{ kind: 'video', url: 'https://cdn.example/v.mp4' }]);
	});

	it('flags content the web preview cannot give us', () => {
		const posts = parsePublicFeed(page(), CHANNEL);
		expect(posts[4].unsupported).toContain('نظرسنجی');
		expect(posts[5].unsupported).toContain('فایل');
		expect(posts[0].unsupported).toBeNull();
	});

	it('ignores posts from other channels on a mixed page', () => {
		const html = page() + feedPage([{ channel: 'other_chan', id: 900, html: 'دیگری' }]);
		const posts = parsePublicFeed(html, CHANNEL);
		expect(posts.every((p) => p.messageId !== 900)).toBe(true);
		expect(posts).toHaveLength(6);
	});

	it('returns an empty list for a page without posts', () => {
		expect(parsePublicFeed(EMPTY_PAGE, CHANNEL)).toEqual([]);
	});

	it('does not crash on malformed html', () => {
		expect(() => parsePublicFeed('<div data-post="x/1"><div class="tgme_widget_message_text">بدون بستن', CHANNEL)).not.toThrow();
		const posts = parsePublicFeed('<div data-post="x/1"><div class="tgme_widget_message_text">بدون بستن', 'x');
		expect(posts[0].text).toBe('بدون بستن');
	});

	it('latestMessageId ignores the cursor default', () => {
		expect(latestMessageId([])).toBe(0);
		expect(latestMessageId(parsePublicFeed(page(), CHANNEL))).toBe(105);
	});

	it('caps albums at the Telegram limit', () => {
		expect(maxFeedMedia()).toBe(10);
	});
});

describe('username helpers', () => {
	it('validates usernames', () => {
		for (const good of ['@my_channel', 'my_channel', 'chan12', 'a_b_c_d']) {
			expect(isValidChannelUsername(good)).toBe(true);
		}
		for (const bad of ['', 'ab', '@', 'my channel', 'شماره', 'a'.repeat(40), '1abc']) {
			expect(isValidChannelUsername(bad)).toBe(false);
		}
	});

	it('normalizes and derives a stable negative channel id', () => {
		expect(normalizeUsername('@My_Channel')).toBe('my_channel');
		const a = publicSourceChannelId('@My_Channel');
		expect(a).toBe(publicSourceChannelId('my_channel'));
		expect(a).toBeLessThan(-1_000_000);
		expect(publicSourceChannelId('other')).not.toBe(a);
		// شناسه‌ی ساختگی با شناسه‌ی واقعی کانال‌ها (-100…) تداخل ندارد
		expect(a).toBeGreaterThan(-1_100_000_000);
	});
});

describe('fetchPublicFeed', () => {
	const okFetch = (html) => async () => new Response(html, { status: 200 });

	it('builds the preview url', () => {
		expect(publicFeedUrl('@chan')).toBe('https://t.me/s/chan');
		expect(publicFeedUrl('chan', 500)).toBe('https://t.me/s/chan?before=500');
	});

	it('returns parsed posts', async () => {
		const result = await fetchPublicFeed('@shadow_news', { fetchImpl: okFetch(page()) });
		expect(result.ok).toBe(true);
		expect(result.posts).toHaveLength(6);
	});

	it('reports 404 as a friend-readable error', async () => {
		const result = await fetchPublicFeed('nope', {
			fetchImpl: async () => new Response('not found', { status: 404 }),
		});
		expect(result).toEqual({ ok: false, error: 'کانال عمومی با این آدرس پیدا نشد.', status: 404 });
	});

	it('reports a private channel (page without channel info)', async () => {
		const result = await fetchPublicFeed('private_chan', { fetchImpl: okFetch(EMPTY_PAGE) });
		expect(result.ok).toBe(false);
		expect(result.error).toContain('پیش‌نمایش عمومی ندارد');
	});

	it('handles network failure without throwing', async () => {
		const result = await fetchPublicFeed('chan', {
			fetchImpl: async () => {
				throw new Error('network down');
			},
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain('اتصال');
	});

	it('sends a browser-like user agent (t.me returns empty pages otherwise)', async () => {
		let headers = null;
		await fetchPublicFeed('chan', {
			fetchImpl: async (_url, init) => {
				headers = init.headers;
				return new Response(page(), { status: 200 });
			},
		});
		expect(String(headers['User-Agent'])).toContain('Mozilla');
	});
});

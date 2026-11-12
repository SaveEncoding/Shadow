import { describe, it, expect } from 'vitest';
import {
	compareIds,
	expandTweetLinks,
	isValidXHandle,
	newestXPostId,
	normalizeXHandle,
	parseXRss,
	parseXTweets,
	parseXUser,
	stripHtml,
	tweetIdFromUrl,
	xItemKey,
	xPostUrl,
	xSourceChannelId,
} from '../src/core/sources/x.js';
import { fetchXTimeline, resolveXProvider, X_NOT_CONFIGURED_MESSAGE } from '../src/telegram/xSource.js';

const HANDLE = 'openai';

describe('handles', () => {
	it('accepts @handle, bare handle and profile urls', () => {
		expect(normalizeXHandle('@OpenAI')).toBe('openai');
		expect(normalizeXHandle('https://x.com/openai')).toBe('openai');
		expect(normalizeXHandle('https://twitter.com/openai/status/123')).toBe('openai');
		expect(normalizeXHandle('  openai  ')).toBe('openai');
	});

	it('validates handles', () => {
		for (const good of ['openai', '@openai', 'a_b_1', 'A1']) expect(isValidXHandle(good)).toBe(true);
		for (const bad of ['', '@', 'with space', 'a'.repeat(16), 'بدون', 'a-b']) expect(isValidXHandle(bad)).toBe(false);
	});

	it('builds stable, non-colliding source ids', () => {
		const a = xSourceChannelId('@OpenAI');
		expect(a).toBe(xSourceChannelId('openai'));
		expect(a).toBeLessThan(-2_000_000_000);
		expect(a).toBeGreaterThanOrEqual(-2_100_000_000);
		expect(xSourceChannelId('other')).not.toBe(a);
		// با شناسه‌های واقعی کانال (-100…) و کانال عمومی وب (-1e6…) تداخل ندارد
		expect(a).toBeLessThan(-1_100_000_000);
	});

	it('builds item keys that stay ordered inside one tweet', () => {
		const id = '1899999999999999999';
		const keys = [0, 1, 2, 3].map((i) => xItemKey(id, i));
		expect(new Set(keys).size).toBe(4);
		expect(keys).toEqual([...keys].sort((a, b) => a - b));
		expect(keys[0]).toBeGreaterThanOrEqual(0);
		// شناسه‌ی توییت از MAX_SAFE_INTEGER بزرگ‌تر است؛ نباید سرریز کند
		expect(keys[0]).toBeLessThan(1_000_000_000);
	});

	it('builds the canonical url', () => {
		expect(xPostUrl('@OpenAI', '123')).toBe('https://x.com/openai/status/123');
	});
});

describe('tweet text', () => {
	it('expands t.co links', () => {
		const text = 'خبر: https://t.co/abc';
		expect(expandTweetLinks(text, [{ url: 'https://t.co/abc', expanded_url: 'https://example.com/full-story' }])).toBe(
			'خبر: https://example.com/full-story',
		);
	});

	it('leaves text alone when there is nothing to expand', () => {
		expect(expandTweetLinks('سلام', [])).toBe('سلام');
	});

	it('compares big ids without Number conversion', () => {
		expect(compareIds('2', '10')).toBe(-1);
		expect(compareIds('1900000000000000000', '1800000000000000000')).toBe(1);
		expect(compareIds('5', '5')).toBe(0);
	});
});

describe('parseXUser', () => {
	it('reads the id and username', () => {
		expect(parseXUser({ data: { id: '123', username: 'OpenAI', name: 'OpenAI' } })).toEqual({
			id: '123',
			handle: 'OpenAI',
			name: 'OpenAI',
		});
	});

	it('returns null for an error payload', () => {
		expect(parseXUser({ errors: [{ title: 'Not Found' }] })).toBeNull();
		expect(parseXUser(null)).toBeNull();
	});
});

describe('parseXTweets', () => {
	const payload = {
		data: [
			{
				id: '101',
				text: 'توییت اول https://t.co/x',
				created_at: '2026-10-24T10:00:00.000Z',
				entities: { urls: [{ url: 'https://t.co/x', expanded_url: 'https://example.com/a' }] },
				attachments: { media_keys: ['3_1', '3_2'] },
			},
			{
				id: '102',
				text: 'کوتاه…',
				created_at: '2026-10-24T11:00:00.000Z',
				note_tweet: { note_tweet_results: { result: { text: 'متن کامل و بلند توییت' } } },
			},
			{
				id: '103',
				text: 'ویدیو',
				created_at: '2026-10-24T12:00:00.000Z',
				attachments: { media_keys: ['7_1'] },
			},
		],
		includes: {
			media: [
				{ media_key: '3_1', type: 'photo', url: 'https://pbs.twimg.com/media/a.jpg', width: 1200, height: 800 },
				{ media_key: '3_2', type: 'photo', url: 'https://pbs.twimg.com/media/b.jpg', width: 800, height: 800 },
				{ media_key: '7_1', type: 'video', preview_image_url: 'https://pbs.twimg.com/media/v.jpg' },
			],
		},
	};

	it('builds posts with expanded links, media and urls', () => {
		const posts = parseXTweets(payload, HANDLE);

		expect(posts).toHaveLength(3);
		expect(posts[0]).toMatchObject({
			externalId: '101',
			text: 'توییت اول https://example.com/a',
			url: `https://x.com/${HANDLE}/status/101`,
			createdAt: Date.UTC(2026, 9, 24, 10) / 1000,
			unsupported: null,
		});
		expect(posts[0].media).toEqual([
			{ kind: 'photo', url: 'https://pbs.twimg.com/media/a.jpg', width: 1200, height: 800 },
			{ kind: 'photo', url: 'https://pbs.twimg.com/media/b.jpg', width: 800, height: 800 },
		]);
	});

	it('uses the full text of long posts (note_tweet)', () => {
		const posts = parseXTweets(payload, HANDLE);
		expect(posts[1].text).toBe('متن کامل و بلند توییت');
	});

	it('marks video-only posts as uncopyable and keeps the flag for the link', () => {
		const posts = parseXTweets(payload, HANDLE);
		expect(posts[2].unsupported).toContain('ویدیو');
		expect(posts[2].videoDropped).toBe(true);
		expect(posts[2].media).toEqual([]);
	});

	it('sorts oldest first and skips the cursor tweet', () => {
		const posts = parseXTweets(payload, HANDLE, '101');
		expect(posts.map((p) => p.externalId)).toEqual(['102', '103']);
	});

	it('survives an empty timeline', () => {
		expect(parseXTweets({ meta: { result_count: 0 } }, HANDLE)).toEqual([]);
		expect(parseXTweets(null, HANDLE)).toEqual([]);
	});
});

describe('RSS bridge parsing', () => {
	const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>@openai</title>
    <item>
      <title>RT by @x: خبر مهم</title>
      <description><![CDATA[<p>متن <b>کامل</b> توییت</p>]]></description>
      <link>https://x.com/openai/status/201</link>
      <guid>https://x.com/openai/status/201</guid>
      <pubDate>Sat, 24 Oct 2026 10:00:00 GMT</pubDate>
      <enclosure url="https://pbs.twimg.com/media/r1.jpg" type="image/jpeg" />
      <media:content url="https://pbs.twimg.com/media/r2.jpg" type="image/jpeg" />
    </item>
    <item>
      <title>توییت دوم</title>
      <description>بدون رسانه</description>
      <link>https://x.com/openai/status/202</link>
      <pubDate>Sat, 24 Oct 2026 11:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

	const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://x.com/openai/status/301</id>
    <title>Atom title</title>
    <content type="html">&lt;p&gt;محتوای اتم&lt;/p&gt;</content>
    <link rel="alternate" href="https://x.com/openai/status/301" />
    <updated>2026-10-24T12:00:00Z</updated>
  </entry>
</feed>`;

	it('parses RSS items with media and html-stripped text', () => {
		const posts = parseXRss(rss, HANDLE);
		expect(posts.map((p) => p.externalId)).toEqual(['201', '202']);
		expect(posts[0].text).toBe('متن کامل توییت');
		expect(posts[0].media.map((m) => m.url)).toEqual(['https://pbs.twimg.com/media/r1.jpg', 'https://pbs.twimg.com/media/r2.jpg']);
		expect(posts[0].createdAt).toBe(Date.UTC(2026, 9, 24, 10) / 1000);
	});

	it('parses Atom entries', () => {
		const posts = parseXRss(atom, HANDLE);
		expect(posts).toHaveLength(1);
		expect(posts[0].externalId).toBe('301');
		expect(posts[0].text).toBe('محتوای اتم');
		expect(posts[0].url).toContain('/status/301');
	});

	it('honours the cursor and unknown formats', () => {
		expect(parseXRss(rss, HANDLE, '202')).toHaveLength(0);
		expect(parseXRss('not xml', HANDLE)).toEqual([]);
	});

	it('reads tweet ids out of urls and strips html', () => {
		expect(tweetIdFromUrl('https://x.com/a/status/123?s=20')).toBe('123');
		expect(tweetIdFromUrl('https://example.com/x')).toBeNull();
		expect(stripHtml('<p>a<br>b</p><p>c</p>')).toBe('a\nb\nc');
	});

	it('keeps the newest id as the next cursor', () => {
		expect(newestXPostId([{ externalId: '10' }, { externalId: '9' }], null)).toBe('10');
		expect(newestXPostId([{ externalId: '3' }], '99')).toBe('99');
	});
});

describe('resolveXProvider', () => {
	it('prefers the official api when a token exists', () => {
		expect(resolveXProvider({ X_BEARER_TOKEN: ' tok ' })).toEqual({ kind: 'official', token: 'tok' });
	});

	it('falls back to a rss template that has {username}', () => {
		expect(resolveXProvider({ X_RSS_TEMPLATE: 'https://bridge.example/x/{username}' })).toEqual({
			kind: 'rss',
			template: 'https://bridge.example/x/{username}',
		});
		// قالبی که {username} ندارد بی‌فایده است
		expect(resolveXProvider({ X_RSS_TEMPLATE: 'https://bridge.example/x' })).toEqual({ kind: 'none' });
	});

	it('explains how to configure it when nothing is set', () => {
		expect(resolveXProvider({})).toEqual({ kind: 'none' });
		expect(X_NOT_CONFIGURED_MESSAGE).toContain('X_BEARER_TOKEN');
		expect(X_NOT_CONFIGURED_MESSAGE).toContain('X_RSS_TEMPLATE');
		expect(X_NOT_CONFIGURED_MESSAGE).toContain('اسکرپ');
	});
});

describe('fetchXTimeline — official api', () => {
	const tweetsPayload = {
		data: [{ id: '900', text: 'سلام از X', created_at: '2026-10-24T10:00:00.000Z' }],
		includes: { media: [] },
	};

	function apiFetch({ tweets = tweetsPayload, user = { data: { id: '42', username: HANDLE } }, status = 200 } = {}) {
		const calls = [];
		const impl = async (url, init) => {
			calls.push({ url: String(url), init });
			if (String(url).includes('/2/users/by/username/')) {
				return new Response(JSON.stringify(user), { status });
			}
			return new Response(JSON.stringify(tweets), { status });
		};
		return { impl, calls };
	}

	it('looks the user up once, then reads the timeline with since_id', async () => {
		const { impl, calls } = apiFetch();
		const result = await fetchXTimeline({
			handle: '@OpenAI',
			sinceId: '899',
			provider: { kind: 'official', token: 'tok' },
			fetchImpl: impl,
		});

		expect(result.ok).toBe(true);
		expect(result.posts).toHaveLength(1);
		expect(result.cursor).toBe('900');
		expect(result.userId).toBe('42');

		expect(calls[0].url).toContain('/2/users/by/username/openai');
		expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
		expect(calls[1].url).toContain('/2/users/42/tweets');
		expect(calls[1].url).toContain('since_id=899');
		expect(calls[1].url).toContain('max_results=5');
		expect(calls[1].url).toContain('note_tweet');
		expect(calls[1].url).toContain('attachments.media_keys');
	});

	it('skips the paid user lookup when the id is cached', async () => {
		const { impl, calls } = apiFetch();
		await fetchXTimeline({
			handle: HANDLE,
			provider: { kind: 'official', token: 'tok' },
			userId: '42',
			fetchImpl: impl,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain('/2/users/42/tweets');
	});

	it('maps auth, quota, rate limit and unknown account errors to Persian messages', async () => {
		const cases = [
			[401, 'کلید X معتبر نیست'],
			[403, 'دسترسی این کلید'],
			[402, 'اعتبار حساب X'],
			[500, 'پاسخ خطا داد'],
		];
		for (const [status, needle] of cases) {
			const { impl } = apiFetch({ status });
			const result = await fetchXTimeline({
				handle: HANDLE,
				provider: { kind: 'official', token: 'tok' },
				fetchImpl: impl,
			});
			expect(result.ok).toBe(false);
			expect(result.error).toContain(needle);
			expect(result.status).toBe(status);
		}
	});

	it('reports 429 with the reset time', async () => {
		const impl = async () => new Response('{}', { status: 429, headers: { 'x-rate-limit-reset': '1800003600' } });
		const result = await fetchXTimeline({
			handle: HANDLE,
			provider: { kind: 'official', token: 'tok' },
			fetchImpl: impl,
		});
		expect(result.error).toContain('سقف نرخ X');
		expect(result.status).toBe(429);
	});

	it('says the account does not exist', async () => {
		const { impl } = apiFetch({ user: { errors: [{ title: 'Not Found' }] } });
		const result = await fetchXTimeline({
			handle: 'ghost',
			provider: { kind: 'official', token: 'tok' },
			fetchImpl: impl,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain('پیدا نشد');
	});

	it('never throws on a network failure', async () => {
		const result = await fetchXTimeline({
			handle: HANDLE,
			provider: { kind: 'official', token: 'tok' },
			fetchImpl: async () => {
				throw new Error('offline');
			},
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain('اتصال');
	});
});

describe('fetchXTimeline — rss bridge', () => {
	const rssBody = `<rss><channel><item>
		<title>t</title><description>متن تازه</description>
		<link>https://x.com/openai/status/555</link>
	</item></channel></rss>`;

	it('substitutes the username into the template', async () => {
		let url = '';
		const result = await fetchXTimeline({
			handle: '@OpenAI',
			sinceId: null,
			provider: { kind: 'rss', template: 'https://bridge.example/x/{username}' },
			fetchImpl: async (u) => {
				url = String(u);
				return new Response(rssBody, { status: 200 });
			},
		});

		expect(url).toBe('https://bridge.example/x/openai');
		expect(result.ok).toBe(true);
		expect(result.posts[0].text).toBe('متن تازه');
		expect(result.cursor).toBe('555');
	});

	it('reports bridge failures', async () => {
		const result = await fetchXTimeline({
			handle: HANDLE,
			provider: { kind: 'rss', template: 'https://bridge.example/{username}' },
			fetchImpl: async () => new Response('nope', { status: 503 }),
		});
		expect(result.ok).toBe(false);
		expect(result.error).toContain('پل RSS');
	});

	it('refuses to do anything without a provider', async () => {
		const result = await fetchXTimeline({ handle: HANDLE, provider: { kind: 'none' } });
		expect(result.ok).toBe(false);
		expect(result.error).toBe(X_NOT_CONFIGURED_MESSAGE);
	});
});

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { publishDuePosts } from '../src/telegram/publishQueue.js';
import { isXSourcesEnabled, resolveXProvider, X_SUSPENDED_MESSAGE } from '../src/telegram/xSource.js';
import { getSourceRule, listPendingPosts, saveSourceRule, upsertXSource } from '../src/telegram/db/postQueue.js';
import { xSourceChannelId } from '../src/core/sources/x.js';
import { CHANNELS_TABLE, createScheduleTables, resetScheduleTables } from './helpers/scheduleSchema.js';

const NOW = 1_800_000_000;
const TARGET = -1001234567890;
const HANDLE = 'openai';
const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>openai</title>
<item>
  <title>tweet</title>
  <link>https://x.com/openai/status/1234567890</link>
  <guid>https://x.com/openai/status/1234567890</guid>
  <description>سلام از پل RSS</description>
  <pubDate>Sat, 24 Oct 2026 10:00:00 GMT</pubDate>
</item>
</channel></rss>`;

class FakeApi {
	constructor() {
		this.calls = [];
	}
	async _send(method, args) {
		this.calls.push({ method, args });
		return { message_id: 700 };
	}
	sendMessage(...a) {
		return this._send('sendMessage', a);
	}
	editMessageText(...a) {
		return this._send('editMessageText', a);
	}
	answerCallbackQuery(...a) {
		return this._send('answerCallbackQuery', a);
	}
}

/** env قلابی برای کرون: همان D1 واقعی + کلیدهای X */
const cronEnv = (over = {}) => ({ my_database: env.my_database, ...over });

let fetchedUrls = [];
const fakeFetch = async (url) => {
	fetchedUrls.push(String(url));
	return new Response(RSS_XML, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
};

async function seedXSource() {
	await saveSourceRule(env.my_database, {
		sourceChannelId: xSourceChannelId(HANDLE),
		sourceTitle: `@${HANDLE}`,
		sourceUsername: HANDLE,
		targetChannelId: TARGET,
		delayMinutes: 5,
		addedBy: 7,
		notifyChatId: 555,
		xHandle: HANDLE,
		now: NOW,
	});
	const rule = await getSourceRule(env.my_database, xSourceChannelId(HANDLE));
	// کِرسر از قبل ست شده تا این پست «تازه» حساب شود
	await upsertXSource(env.my_database, { ruleId: rule.id, handle: HANDLE, now: NOW, cursorId: '100' });
	await env.my_database.prepare('UPDATE post_x_sources SET last_polled_at = NULL WHERE rule_id = ?').bind(rule.id).run();
	return rule;
}

beforeAll(async () => {
	await createScheduleTables(env.my_database);
	await env.my_database.exec(CHANNELS_TABLE);
});

beforeEach(async () => {
	await resetScheduleTables(env.my_database);
	await env.my_database.exec('DELETE FROM channels;');
	await env.my_database
		.prepare('INSERT INTO channels (channel_id, title, username) VALUES (?, ?, ?)')
		.bind(TARGET, 'کانال من', 'my_channel')
		.run();
	fetchedUrls = [];
});

describe('isXSourcesEnabled', () => {
	it('is off by default (feature suspended)', () => {
		expect(isXSourcesEnabled({})).toBe(false);
		expect(isXSourcesEnabled({ X_SOURCES_ENABLED: '' })).toBe(false);
		expect(isXSourcesEnabled({ X_SOURCES_ENABLED: '0' })).toBe(false);
		expect(isXSourcesEnabled({ X_SOURCES_ENABLED: 'false' })).toBe(false);
	});

	it('turns on only with an explicit truthy value', () => {
		for (const raw of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
			expect(isXSourcesEnabled({ X_SOURCES_ENABLED: raw })).toBe(true);
		}
	});

	it('being suspended is independent from having a key', () => {
		// کلید هست ولی فیچر تعلیق است
		const env1 = { X_BEARER_TOKEN: 'tok' };
		expect(resolveXProvider(env1).kind).toBe('official');
		expect(isXSourcesEnabled(env1)).toBe(false);
	});

	it('has an honest Persian message for the suspended state', () => {
		expect(X_SUSPENDED_MESSAGE).toContain('تعلیق');
		expect(X_SUSPENDED_MESSAGE).toContain('X_SOURCES_ENABLED');
	});
});

describe('cron while suspended', () => {
	it('never calls X, even with a key and a connected account', async () => {
		await seedXSource();

		const result = await publishDuePosts(cronEnv({ X_BEARER_TOKEN: 'tok', X_RSS_TEMPLATE: 'https://bridge.test/u/{username}' }), {
			api: new FakeApi(),
			now: NOW,
			fetchImpl: fakeFetch,
		});

		expect(fetchedUrls).toHaveLength(0);
		expect(result.xPolled).toBe(0);
		expect(result.xQueued).toBe(0);
		expect(await listPendingPosts(env.my_database, TARGET)).toHaveLength(0);
	});

	it('keeps publishing the posts that were queued before the suspension', async () => {
		await seedXSource();
		// یک پست از قبل در صف (مثل چیزی که وقتی فیچر روشن بود ساخته شده)
		const { createQueuedPost, appendItem, finalizePost } = await import('../src/telegram/db/postQueue.js');
		const postId = await createQueuedPost(env.my_database, {
			sourceChannelId: xSourceChannelId(HANDLE),
			sourceTitle: `@${HANDLE}`,
			sourceUsername: HANDLE,
			targetChannelId: TARGET,
			mediaGroupId: null,
			createdBy: 555,
			now: NOW - 600,
		});
		await appendItem(
			env.my_database,
			postId,
			{ sourceMessageId: 1, kind: 'text', fileId: null, text: 'پست قبلی', entities: null, extra: null },
			NOW - 600,
		);
		await finalizePost(env.my_database, postId, NOW - 60, NOW - 600);

		const api = new FakeApi();
		const result = await publishDuePosts(cronEnv({ X_BEARER_TOKEN: 'tok' }), { api, now: NOW, fetchImpl: fakeFetch });

		expect(result.published).toBe(1);
		expect(api.calls.some((call) => call.args?.[0] === TARGET && call.args?.[1] === 'پست قبلی')).toBe(true);
		expect(fetchedUrls).toHaveLength(0);
	});
});

describe('cron when re-enabled', () => {
	it('polls X and queues the new post', async () => {
		await seedXSource();

		const result = await publishDuePosts(cronEnv({ X_SOURCES_ENABLED: '1', X_RSS_TEMPLATE: 'https://bridge.test/u/{username}' }), {
			api: new FakeApi(),
			now: NOW,
			fetchImpl: fakeFetch,
		});

		expect(fetchedUrls).toHaveLength(1);
		expect(fetchedUrls[0]).toContain('/u/openai');
		expect(result.xPolled).toBe(1);
		expect(result.xQueued).toBe(1);

		const [post] = await listPendingPosts(env.my_database, TARGET);
		expect(post.items[0].text).toBe('سلام از پل RSS');
	});
});

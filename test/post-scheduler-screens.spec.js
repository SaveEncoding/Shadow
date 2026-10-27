import { describe, it, expect } from 'vitest';
import {
	addSourceKeyboard,
	addSourceText,
	channelScheduleKeyboard,
	channelScheduleText,
	delayPickerKeyboard,
	describeItems,
	manualCaptureText,
	postDetailKeyboard,
	postDetailText,
	queueKeyboard,
	queueText,
	schedulerHomeKeyboard,
	schedulerHomeText,
	sourceName,
	statusLabel,
} from '../src/telegram/ui/schedulerScreens.js';
import { DELAY_PRESETS } from '../src/core/schedule/timing.js';

const NOW = 1_800_000_000;
const TARGET = -1001234567890;
const SOURCE = -1009876543210;

const post = (overrides = {}) => ({
	id: 12,
	sourceChannelId: SOURCE,
	sourceTitle: 'کانال مبدأ',
	sourceUsername: 'source_chan',
	targetChannelId: TARGET,
	mediaGroupId: null,
	status: 'scheduled',
	publishAt: NOW + 1800,
	finalizeAt: null,
	createdAt: NOW,
	updatedAt: NOW,
	publishedAt: null,
	publishedMessageId: null,
	attempts: 0,
	lastError: null,
	createdBy: 555,
	previewChatId: null,
	previewMessageId: null,
	edited: false,
	items: [
		{ sourceMessageId: 1, kind: 'text', fileId: null, text: 'سلام دنیا', entities: null, extra: null },
	],
	...overrides,
});

const rule = (overrides = {}) => ({
	id: 1,
	sourceChannelId: SOURCE,
	sourceTitle: 'کانال مبدأ',
	sourceUsername: 'source_chan',
	targetChannelId: TARGET,
	delayMinutes: 30,
	enabled: true,
	notifyChatId: 555,
	addedBy: 7,
	createdAt: NOW,
	...overrides,
});

const buttons = (kb) => kb.inline_keyboard.flat().map((b) => b.callback_data);

describe('home screen', () => {
	it('lists channels with their pending count', () => {
		const text = schedulerHomeText([
			{ title: 'کانال من', pending: 3 },
			{ title: 'دوم', pending: 0 },
		]);
		expect(text).toContain('کانال من');
		expect(text).toContain('۳ در صف');

		const kb = schedulerHomeKeyboard([{ id: TARGET, title: 'کانال من', pending: 3 }]);
		expect(buttons(kb)).toContain(`ps:c:${TARGET}`);
		expect(buttons(kb)).toContain('ps:help');
	});

	it('explains that a channel must be registered first', () => {
		expect(schedulerHomeText([])).toContain('هنوز کانالی ثبت نکرده‌ای');
		// بدون کانال، کیبورد فقط راهنما و بازگشت به منو دارد
		expect(buttons(schedulerHomeKeyboard([]))).toEqual(['ps:help', 'm:h']);
	});
});

describe('channel screen', () => {
	it('shows the source by name (not a raw id)', () => {
		const text = channelScheduleText({
			channelId: TARGET,
			title: 'کانال من',
			rules: [rule()],
			pending: 2,
			lastPublishedAt: NOW - 3600,
			now: NOW,
		});

		expect(text).toContain('کانال مبدأ');
		expect(text).toContain('۳۰ دقیقه');
		expect(text).toContain('۲');
		expect(text).toContain('آخرین انتشار');
		expect(text).not.toContain(String(SOURCE));
	});

	it('falls back to the username, then to the id', () => {
		expect(sourceName({ sourceTitle: null, sourceUsername: 'chan', sourceChannelId: SOURCE })).toBe('@chan');
		expect(sourceName({ sourceTitle: null, sourceUsername: null, sourceChannelId: 123 })).toBe('۱۲۳');
		expect(sourceName({ sourceTitle: 'عنوان', sourceUsername: 'chan', sourceChannelId: SOURCE })).toBe('عنوان');
	});

	it('offers the source actions and the queue', () => {
		const kb = channelScheduleKeyboard({
			channelId: TARGET,
			title: 'کانال من',
			rules: [rule()],
			pending: 1,
			lastPublishedAt: null,
			now: NOW,
		});
		const data = buttons(kb);
		expect(data).toContain(`ps:dp:r${SOURCE}`);
		expect(data).toContain(`ps:tog:${SOURCE}`);
		expect(data).toContain(`ps:rdel:${SOURCE}`);
		expect(data).toContain(`ps:src:${TARGET}`);
		expect(data).toContain(`ps:man:${TARGET}`);
		expect(data).toContain(`ps:q:${TARGET}`);
	});

	it('shows the setup steps while there is no source', () => {
		const text = channelScheduleText({
			channelId: TARGET,
			title: 'کانال من',
			rules: [],
			pending: 0,
			lastPublishedAt: null,
			now: NOW,
		});
		expect(text).toContain('ادمین');
		expect(text).toContain('فوروارد');
	});
});

describe('add source and manual copy', () => {
	it('asks for the forward and offers preset delays', () => {
		const text = addSourceText('کانال من');
		expect(text).toContain('فوروارد');

		const data = buttons(addSourceKeyboard(TARGET));
		expect(data).toContain(`ps:sd:${TARGET}:30`);
		expect(data).toContain(`ps:c:${TARGET}`);
	});

	it('explains the manual copy limits', () => {
		const text = manualCaptureText('کانال من', 15);
		expect(text).toContain('فوروارد');
		expect(text).toContain('۱۵ دقیقه');
		expect(text).toContain('پشتیبانی نمی‌شوند');
	});
});

describe('delay picker', () => {
	it('lists every preset', () => {
		const data = buttons(delayPickerKeyboard(`r${SOURCE}`, 'rule'));
		for (const preset of DELAY_PRESETS) {
			expect(data).toContain(`ps:ds:r${SOURCE}:${preset.minutes}`);
		}
	});

	it('goes back to the post itself for a post scope', () => {
		const data = buttons(delayPickerKeyboard('p12', 'post'));
		expect(data).toContain('ps:p:12');
		expect(data).toContain('ps:ds:p12:30');
	});
});

describe('queue and post detail', () => {
	it('summarizes the queue with time and remaining', () => {
		const text = queueText([post()], 'کانال من', NOW);
		expect(text).toContain('سلام دنیا');
		expect(text).toContain('۳۰ دقیقه دیگر');

		const data = buttons(queueKeyboard([post()], TARGET));
		expect(data).toContain('ps:p:12');
		expect(data).toContain(`ps:c:${TARGET}`);
	});

	it('says the queue is empty', () => {
		expect(queueText([], 'کانال من', NOW)).toContain('صف خالی است');
	});

	it('shows the post, its source and the actions', () => {
		const text = postDetailText(post(), 'کانال من', NOW);
		expect(text).toContain('کانال مبدأ');
		expect(text).toContain('سلام دنیا');
		expect(text).toContain('۳۰ دقیقه دیگر');

		const data = buttons(postDetailKeyboard(post(), NOW));
		expect(data).toContain('ps:pub:12');
		expect(data).toContain('ps:txt:12');
		expect(data).toContain('ps:dp:p12');
		expect(data).toContain('ps:del:12');
		expect(data).toContain('ps:view:12');
	});

	it('marks manual posts as manual', () => {
		expect(postDetailText(post({ sourceChannelId: 0, sourceTitle: null }), 'کانال من', NOW)).toContain('کپی دستی');
	});

	it('shows the error of a failed post', () => {
		const text = postDetailText(post({ status: 'failed', lastError: 'bot is not a member' }), 'کانال من', NOW);
		expect(text).toContain('ناموفق');
		expect(text).toContain('bot is not a member');
	});

	it('escapes user text instead of injecting HTML', () => {
		const text = postDetailText(
			post({ items: [{ sourceMessageId: 1, kind: 'text', fileId: null, text: '<b>hack</b>', entities: null, extra: null }] }),
			'کانال من',
			NOW,
		);
		expect(text).toContain('&lt;b&gt;hack&lt;/b&gt;');
	});

	it('describes albums by size, not by one item', () => {
		const items = [
			{ sourceMessageId: 1, kind: 'photo', fileId: 'a', text: null, entities: null, extra: null },
			{ sourceMessageId: 2, kind: 'photo', fileId: 'b', text: null, entities: null, extra: null },
		];
		expect(describeItems(items)).toContain('آلبوم ۲ آیتمی');
		expect(describeItems([])).toBe('بدون محتوا');
	});

	it('labels statuses in Persian', () => {
		expect(statusLabel('published')).toContain('منتشر');
		expect(statusLabel('nonsense')).toBe('nonsense');
	});

	it('keeps every callback under the 64-byte Telegram limit', () => {
		const all = [
			...buttons(postDetailKeyboard(post(), NOW)),
			...buttons(queueKeyboard([post()], TARGET)),
			...buttons(addSourceKeyboard(TARGET)),
			...buttons(delayPickerKeyboard('p12', 'post')),
		];
		for (const data of all) {
			expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
		}
	});
});

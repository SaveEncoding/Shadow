import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
	CRON_NOTIFY_KEYS,
	DEFAULT_CRON_NOTIFY_STATE,
	cronNotifyFlag,
	cronNotifyStateFromRows,
	isCronNotifyEnabled,
	isCronNotifyTarget,
	parseNotifyFlag,
	withCronNotifyFlag,
} from '../src/core/settings/cronNotify.js';
import { getCronNotifyState, setCronNotifyFlag } from '../src/telegram/db/cronNotify.js';
import { setErrorLogChatId } from '../src/telegram/db/settings.js';

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));

vi.mock('../src/telegram/services/telegramService.js', () => ({
	sendMessage: sendMessageMock,
	escapeHtml: (value) => String(value),
}));

import { notifyCronLog } from '../src/telegram/services/cronLog.js';

/**
 * «اعلان‌های خودکار کرون» — کلید خاموش/روشن پیام‌های گزارشی در گپ لاگ.
 *
 * سه چیز را جدا نگه می‌داریم:
 *   ۱. منطق خالص (پیش‌فرض‌ها، اولویت کلید اصلی) — بدون D1
 *   ۲. ذخیره/خواندن در `bot_settings` — روی D1 واقعی تست
 *   ۳. فرستادن یا نفرستادن پیام — با `sendMessage` قلابی
 */

beforeAll(async () => {
	await env.my_database.exec(
		'CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (CURRENT_TIMESTAMP));',
	);
});

beforeEach(async () => {
	await env.my_database.exec('DELETE FROM bot_settings;');
	sendMessageMock.mockReset();
	sendMessageMock.mockResolvedValue({ message_id: 1 });
});

describe('cron notify: pure state', () => {
	it('defaults to on when no setting rows exist (old behaviour)', () => {
		const state = cronNotifyStateFromRows([]);

		expect(state).toEqual(DEFAULT_CRON_NOTIFY_STATE);
		for (const key of CRON_NOTIFY_KEYS) expect(isCronNotifyEnabled(state, key)).toBe(true);
	});

	it('parses the flags it writes, and treats anything else as unset', () => {
		for (const raw of ['1', ' true ', 'on', 'YES']) expect(parseNotifyFlag(raw)).toBe(true);
		for (const raw of ['0', 'false', 'off', 'no']) expect(parseNotifyFlag(raw)).toBe(false);
		for (const raw of [null, undefined, '', 'maybe']) expect(parseNotifyFlag(raw)).toBeNull();
	});

	it('lets the master switch override the per-cron switches', () => {
		const state = cronNotifyStateFromRows([{ key: 'cron_notify_master', value: '0' }]);

		expect(state.master).toBe(false);
		// وضعیت ذخیره‌شده‌ی تک‌تک کرون‌ها دست‌نخورده می‌ماند تا با روشن‌کردن کلید اصلی برگردد
		expect(state.items).toEqual({ cleanup: true, admin_sync: true });
		expect(isCronNotifyEnabled(state, 'cleanup')).toBe(false);
		expect(isCronNotifyEnabled(state, 'admin_sync')).toBe(false);
	});

	it('turns off only the cron that was switched off', () => {
		const state = cronNotifyStateFromRows([{ key: 'cron_notify:cleanup', value: '0' }]);

		expect(isCronNotifyEnabled(state, 'cleanup')).toBe(false);
		expect(isCronNotifyEnabled(state, 'admin_sync')).toBe(true);
	});

	it('withCronNotifyFlag returns a new state and never mutates the input', () => {
		const before = cronNotifyStateFromRows([]);
		const after = withCronNotifyFlag(before, 'cleanup', false);

		expect(cronNotifyFlag(after, 'cleanup')).toBe(false);
		expect(cronNotifyFlag(after, 'admin_sync')).toBe(true);
		expect(cronNotifyFlag(before, 'cleanup')).toBe(true);
		expect(after).not.toBe(before);
	});

	it('accepts only the known toggle targets', () => {
		for (const value of ['master', ...CRON_NOTIFY_KEYS]) expect(isCronNotifyTarget(value)).toBe(true);
		for (const value of ['', 'x', 'admin:cron:t:master', undefined]) expect(isCronNotifyTarget(value)).toBe(false);
	});
});

describe('cron notify: D1 settings', () => {
	it('reads defaults with a single empty-row query', async () => {
		expect(await getCronNotifyState(env.my_database)).toEqual(DEFAULT_CRON_NOTIFY_STATE);
	});

	it('persists the master switch and keeps per-cron values', async () => {
		await setCronNotifyFlag(env.my_database, 'cleanup', false);
		await setCronNotifyFlag(env.my_database, 'master', false);

		const state = await getCronNotifyState(env.my_database);
		expect(state.master).toBe(false);
		expect(state.items.cleanup).toBe(false);
		expect(state.items.admin_sync).toBe(true);

		await setCronNotifyFlag(env.my_database, 'master', true);
		const back = await getCronNotifyState(env.my_database);
		expect(back.master).toBe(true);
		// خاموشیِ قبلیِ پاک‌سازی با روشن‌کردن کلید اصلی از بین نمی‌رود
		expect(back.items.cleanup).toBe(false);
	});
});

describe('cron notify: sending the log message', () => {
	it('sends nothing when the cron switch is off', async () => {
		await setErrorLogChatId(env.my_database, -100999);
		await setCronNotifyFlag(env.my_database, 'admin_sync', false);

		const sent = await notifyCronLog(env, 'admin_sync', 'گزارش', 'test');

		expect(sent).toBe(false);
		expect(sendMessageMock).not.toHaveBeenCalled();
	});

	it('sends nothing when the master switch is off', async () => {
		await setErrorLogChatId(env.my_database, -100999);
		await setCronNotifyFlag(env.my_database, 'master', false);

		expect(await notifyCronLog(env, 'cleanup', 'گزارش', 'test')).toBe(false);
		expect(sendMessageMock).not.toHaveBeenCalled();
	});

	it('sends nothing (but does not throw) when no log chat is configured', async () => {
		expect(await notifyCronLog(env, 'cleanup', 'گزارش', 'test')).toBe(false);
		expect(sendMessageMock).not.toHaveBeenCalled();
	});

	it('sends to the configured chat and topic when enabled', async () => {
		await setErrorLogChatId(env.my_database, -100999, 42);

		const sent = await notifyCronLog(env, 'cleanup', '🧹 گزارش', 'test');

		expect(sent).toBe(true);
		expect(sendMessageMock).toHaveBeenCalledTimes(1);

		// مقایسه‌ی عمیق با `env` ممکن نیست: D1Database قابل سریالایز شدن نیست،
		// پس همان object را با مرجع مقایسه می‌کنیم.
		const [envArg, chatArg, textArg, optionsArg] = sendMessageMock.mock.calls[0];
		expect(envArg).toBe(env);
		expect(chatArg).toBe(-100999);
		expect(textArg).toBe('🧹 گزارش');
		expect(optionsArg).toEqual({ threadId: 42 });
	});
});

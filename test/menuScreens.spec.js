import { describe, it, expect } from 'vitest';
import {
	homeText,
	homeKeyboard,
	channelsListText,
	channelDetailText,
	soonText,
	adminHubKeyboard,
	cronNotifyKeyboard,
	cronNotifyText,
} from '../src/telegram/ui/screens.js';
import { Role } from '../src/telegram/constants/roles.js';
import { DEFAULT_CRON_NOTIFY_STATE, CRON_NOTIFY_KEYS, withCronNotifyFlag } from '../src/core/settings/cronNotify.js';

describe('menu screens', () => {
	it('home shows admin button only for EXEC_ADMIN+', () => {
		const normal = homeKeyboard(Role.NORMAL)
			.inline_keyboard.flat()
			.map((b) => b.callback_data);
		const admin = homeKeyboard(Role.EXEC_ADMIN)
			.inline_keyboard.flat()
			.map((b) => b.callback_data);
		expect(normal).not.toContain('m:ad');
		expect(admin).toContain('m:ad');
		expect(homeText(Role.FOUNDER)).toContain('منوی اصلی');
	});

	it('channels list empty state is friendly', () => {
		expect(channelsListText([], 1)).toContain('هنوز کانالی');
	});

	it('channel detail includes suffix state', () => {
		const text = channelDetailText(
			{
				title: 'Test',
				channel_id: -1001,
				username: 't',
				owner_id: 1,
				registered_by: 1,
				official_suffix: null,
				suffix_skip_marker: null,
			},
			1,
		);
		expect(text).toContain('تنظیم نشده');
	});

	it('soon screen names known features', () => {
		expect(soonText('edit')).toContain('ویرایش');
	});

	it('admin hub exposes the cron notification toggle', () => {
		const callbacks = adminHubKeyboard(Role.EXEC_ADMIN)
			.inline_keyboard.flat()
			.map((b) => b.callback_data);
		expect(callbacks).toContain('admin:cron');
	});

	it('cron notification screen explains that only the message is muted', () => {
		const text = cronNotifyText(DEFAULT_CRON_NOTIFY_STATE);
		expect(text).toContain('فقط');
		expect(text).toContain('اجرا می‌شوند');
		expect(text).toContain('✅');
	});

	it('cron notification toggles fit Telegram callback_data and reflect the state', () => {
		const off = withCronNotifyFlag(withCronNotifyFlag(DEFAULT_CRON_NOTIFY_STATE, 'master', false), 'cleanup', false);
		const buttons = cronNotifyKeyboard(off).inline_keyboard.flat();

		for (const button of buttons) {
			if (button.callback_data) expect(button.callback_data.length).toBeLessThanOrEqual(64);
		}

		const byCallback = new Map(buttons.map((b) => [b.callback_data, b.text]));
		// کلید اصلی و پاک‌سازی خاموش شده‌اند؛ همگام‌سازی باید دست‌نخورده روشن بماند.
		expect(byCallback.get('admin:cron:t:master')).toContain('⛔');
		expect(byCallback.get('admin:cron:t:cleanup')).toContain('⛔');
		expect(byCallback.get('admin:cron:t:admin_sync')).toContain('✅');
	});
});

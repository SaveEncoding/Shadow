import { describe, it, expect } from 'vitest';
import {
	homeText,
	homeKeyboard,
	channelsListText,
	channelDetailText,
	soonText,
} from '../src/telegram/ui/screens.js';
import { Role } from '../src/telegram/constants/roles.js';

describe('menu screens', () => {
	it('home shows admin button only for EXEC_ADMIN+', () => {
		const normal = homeKeyboard(Role.NORMAL).inline_keyboard.flat().map((b) => b.callback_data);
		const admin = homeKeyboard(Role.EXEC_ADMIN).inline_keyboard.flat().map((b) => b.callback_data);
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
			1
		);
		expect(text).toContain('تنظیم نشده');
	});

	it('soon screen names known features', () => {
		expect(soonText('edit')).toContain('ویرایش');
	});
});

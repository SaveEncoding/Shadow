import { describe, it, expect } from 'vitest';
import {
	getForwardedChannel,
	isChannelOwner,
	describeChannelAccessError,
	describeNonOwnerStatus,
} from '../src/telegram/features/channels.js';

describe('getForwardedChannel', () => {
	it('returns the channel chat when the message is forwarded from a channel', () => {
		const message = {
			forward_origin: {
				type: 'channel',
				chat: { id: -100123, title: 'My Channel', username: 'mychannel' },
			},
		};
		expect(getForwardedChannel(message)).toEqual({ id: -100123, title: 'My Channel', username: 'mychannel' });
	});

	it('returns null for a message forwarded from a user, not a channel', () => {
		const message = {
			forward_origin: { type: 'user', sender_user: { id: 1, first_name: 'Ali' } },
		};
		expect(getForwardedChannel(message)).toBeNull();
	});

	it('returns null for a plain (non-forwarded) message', () => {
		expect(getForwardedChannel({ text: 'hello' })).toBeNull();
	});

	it('returns null for a null/undefined message', () => {
		expect(getForwardedChannel(null)).toBeNull();
		expect(getForwardedChannel(undefined)).toBeNull();
	});
});

describe('isChannelOwner', () => {
	it('accepts "administrator" and "creator" statuses', () => {
		expect(isChannelOwner('administrator')).toBe(true);
		expect(isChannelOwner('creator')).toBe(true);
	});

	it('rejects "member", "left", "kicked", and unknown statuses', () => {
		expect(isChannelOwner('member')).toBe(false);
		expect(isChannelOwner('left')).toBe(false);
		expect(isChannelOwner('kicked')).toBe(false);
		expect(isChannelOwner(undefined)).toBe(false);
	});
});

describe('describeChannelAccessError', () => {
	it('tells the user the bot has not been added to the channel', () => {
		const err = { description: 'Forbidden: bot is not a member of the channel chat' };
		expect(describeChannelAccessError(err)).toMatch(/اضافه نشده/);
	});

	it('tells the user the channel could not be identified', () => {
		const err = { description: 'Bad Request: chat not found' };
		expect(describeChannelAccessError(err)).toMatch(/شناسایی نشد/);
	});

	it('falls back to a generic message for unrecognized errors', () => {
		const err = { description: 'Internal Server Error' };
		expect(describeChannelAccessError(err)).toMatch(/خطا در بررسی/);
	});

	it('falls back to a generic message when there is no description at all', () => {
		expect(describeChannelAccessError(new Error('network down'))).toMatch(/خطا در بررسی/);
		expect(describeChannelAccessError(null)).toMatch(/خطا در بررسی/);
	});
});

describe('describeNonOwnerStatus', () => {
	it("tells the user they aren't even a member for left/kicked statuses", () => {
		expect(describeNonOwnerStatus('left')).toMatch(/عضو این کانال نیستید/);
		expect(describeNonOwnerStatus('kicked')).toMatch(/عضو این کانال نیستید/);
	});

	it('tells a plain member they need to be an admin/owner', () => {
		expect(describeNonOwnerStatus('member')).toMatch(/ادمین‌ها یا سازنده/);
	});
});

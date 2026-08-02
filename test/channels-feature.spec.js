import { describe, it, expect } from 'vitest';
import { getForwardedChannel, isChannelOwner } from '../src/telegram/features/channels.js';

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

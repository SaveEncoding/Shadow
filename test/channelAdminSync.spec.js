import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getChatAdministratorsMock, getChannelsNeedingAdminSyncMock, syncChannelAdminsMock } = vi.hoisted(() => ({
	getChatAdministratorsMock: vi.fn(),
	getChannelsNeedingAdminSyncMock: vi.fn(),
	syncChannelAdminsMock: vi.fn(),
}));

vi.mock('grammy', () => ({
	Api: vi.fn().mockImplementation(() => ({
		getChatAdministrators: getChatAdministratorsMock,
	})),
}));
vi.mock('../src/telegram/db/channels.js', () => ({
	getChannelsNeedingAdminSync: getChannelsNeedingAdminSyncMock,
	syncChannelAdmins: syncChannelAdminsMock,
}));

const fakeEnv = { TELEGRAM_TOKEN: 'fake-token', my_database: {} };

describe('refreshChannelAdmins', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('syncs every channel in the batch using one getChatAdministrators call each', async () => {
		const { refreshChannelAdmins } = await import('../src/telegram/channelAdminSync.js');

		getChannelsNeedingAdminSyncMock.mockResolvedValueOnce([
			{ channel_id: -100001 },
			{ channel_id: -100002 },
		]);
		getChatAdministratorsMock
			.mockResolvedValueOnce([{ user: { id: 1 } }, { user: { id: 2 } }])
			.mockResolvedValueOnce([{ user: { id: 3 } }]);
		syncChannelAdminsMock.mockResolvedValueOnce({ added: 2, removed: 0 }).mockResolvedValueOnce({ added: 1, removed: 0 });

		const result = await refreshChannelAdmins(fakeEnv);

		expect(getChatAdministratorsMock).toHaveBeenCalledTimes(2);
		expect(syncChannelAdminsMock).toHaveBeenNthCalledWith(1, fakeEnv.my_database, -100001, [1, 2]);
		expect(syncChannelAdminsMock).toHaveBeenNthCalledWith(2, fakeEnv.my_database, -100002, [3]);
		expect(result).toEqual({ synced: 2, added: 3, removed: 0, failed: 0 });
	});

	it('keeps going and reports a failure count when one channel errors out', async () => {
		const { refreshChannelAdmins } = await import('../src/telegram/channelAdminSync.js');

		getChannelsNeedingAdminSyncMock.mockResolvedValueOnce([{ channel_id: -100003 }, { channel_id: -100004 }]);
		getChatAdministratorsMock
			.mockRejectedValueOnce(new Error('Bad Request: chat not found'))
			.mockResolvedValueOnce([{ user: { id: 5 } }]);
		syncChannelAdminsMock.mockResolvedValueOnce({ added: 1, removed: 0 });

		const result = await refreshChannelAdmins(fakeEnv);

		// کانال دومی باید بدون توقف روی خطای اولی sync بشه
		expect(syncChannelAdminsMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ synced: 2, added: 1, removed: 0, failed: 1 });
	});

	it('does nothing (and does not error) when there are no channels to sync', async () => {
		const { refreshChannelAdmins } = await import('../src/telegram/channelAdminSync.js');
		getChannelsNeedingAdminSyncMock.mockResolvedValueOnce([]);

		const result = await refreshChannelAdmins(fakeEnv);

		expect(getChatAdministratorsMock).not.toHaveBeenCalled();
		expect(result).toEqual({ synced: 0, added: 0, removed: 0, failed: 0 });
	});
});

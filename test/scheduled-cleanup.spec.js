import { describe, it, expect, vi, beforeEach } from 'vitest';

const { deleteInactiveUsersMock, notifyCronLogMock, reportErrorMock } = vi.hoisted(() => ({
	deleteInactiveUsersMock: vi.fn(),
	notifyCronLogMock: vi.fn(),
	reportErrorMock: vi.fn(),
}));

vi.mock('../src/telegram/services/userService.js', () => ({
	UserService: class {
		constructor(db) {
			this.db = db;
		}
		deleteInactiveUsers(days) {
			return deleteInactiveUsersMock(days);
		}
	},
}));
vi.mock('../src/telegram/services/cronLog.js', () => ({ notifyCronLog: notifyCronLogMock }));
vi.mock('../src/telegram/utils/Error.js', () => ({ reportError: reportErrorMock }));

const fakeEnv = { TELEGRAM_TOKEN: 'fake-token', my_database: {} };

describe('runScheduledCleanup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		notifyCronLogMock.mockResolvedValue(true);
	});

	it('reports the run to the log chat through the notification gate', async () => {
		const { runScheduledCleanup } = await import('../src/telegram/scheduled.js');
		deleteInactiveUsersMock.mockResolvedValueOnce({ deletedCount: 2, deletedIds: [11, 12] });

		await runScheduledCleanup(fakeEnv);

		expect(deleteInactiveUsersMock).toHaveBeenCalledWith(30);
		expect(notifyCronLogMock).toHaveBeenCalledTimes(1);
		const [envArg, keyArg, textArg, contextArg] = notifyCronLogMock.mock.calls[0];
		expect(envArg).toBe(fakeEnv);
		expect(keyArg).toBe('cleanup');
		expect(textArg).toContain('2 کاربر غیرفعال');
		expect(contextArg).toBe('cleanup');
	});

	it('still reports a no-op run (behaviour unchanged)', async () => {
		const { runScheduledCleanup } = await import('../src/telegram/scheduled.js');
		deleteInactiveUsersMock.mockResolvedValueOnce({ deletedCount: 0, deletedIds: [] });

		await runScheduledCleanup(fakeEnv);

		expect(notifyCronLogMock.mock.calls[0][2]).toContain('هیچ کاربر غیرفعالی');
	});

	it('reports real failures to the error log and does not swallow them', async () => {
		const { runScheduledCleanup } = await import('../src/telegram/scheduled.js');
		const boom = new Error('D1 down');
		deleteInactiveUsersMock.mockRejectedValueOnce(boom);

		await runScheduledCleanup(fakeEnv);

		expect(notifyCronLogMock).not.toHaveBeenCalled();
		expect(reportErrorMock).toHaveBeenCalledWith(fakeEnv, 'runScheduledCleanup', boom);
	});
});

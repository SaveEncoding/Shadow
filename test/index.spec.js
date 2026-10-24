import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExecutionContext, waitOnExecutionContext, env } from 'cloudflare:test';

// از vi.hoisted استفاده می‌کنیم چون vi.mock به بالای فایل hoist می‌شه؛
// اگه mock function‌ها رو مستقیم با const بسازیم، هنگام اجرای factory
// هنوز initialize نشدن (خطای "Cannot access before initialization").
const {
	handleTelegramUpdateMock,
	handleWebsiteUpdateMock,
	reportErrorToAdminMock,
	publishDuePostsMock,
	runScheduledCleanupMock,
	refreshChannelAdminsMock,
} = vi.hoisted(() => ({
	handleTelegramUpdateMock: vi.fn(),
	handleWebsiteUpdateMock: vi.fn(),
	reportErrorToAdminMock: vi.fn(),
	publishDuePostsMock: vi.fn(),
	runScheduledCleanupMock: vi.fn(),
	refreshChannelAdminsMock: vi.fn(),
}));

vi.mock('../src/telegram/main-tel.js', () => ({
	handleTelegramUpdate: handleTelegramUpdateMock,
}));
vi.mock('../src/website/main-web.js', () => ({
	handleWebsiteUpdate: handleWebsiteUpdateMock,
}));
vi.mock('../src/telegram/publishQueue.js', () => ({
	publishDuePosts: publishDuePostsMock,
}));
vi.mock('../src/telegram/scheduled.js', () => ({
	runScheduledCleanup: runScheduledCleanupMock,
}));
vi.mock('../src/telegram/channelAdminSync.js', () => ({
	refreshChannelAdmins: refreshChannelAdminsMock,
}));

// کد فعلی `reportError` را import می‌کند (نام قدیمی: reportErrorToAdmin).
vi.mock('../src/telegram/utils/Error.js', () => ({
	reportError: reportErrorToAdminMock,
	reportErrorToAdmin: reportErrorToAdminMock,
}));

describe('Worker.fetch routing', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('routes POST /telegram to the telegram handler', async () => {
		handleTelegramUpdateMock.mockResolvedValueOnce(new Response('telegram-ok'));
		vi.resetModules();
		const worker = (await import('../src/index.js')).default;

		const request = new Request('http://example.com/telegram', { method: 'POST' });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(handleTelegramUpdateMock).toHaveBeenCalledTimes(1);
		expect(handleWebsiteUpdateMock).not.toHaveBeenCalled();
		expect(await response.text()).toBe('telegram-ok');
	});

	it('a GET to /telegram is NOT routed to the telegram handler (only POST is)', async () => {
		handleWebsiteUpdateMock.mockResolvedValueOnce(new Response('site-ok'));
		vi.resetModules();
		const worker = (await import('../src/index.js')).default;

		const request = new Request('http://example.com/telegram', { method: 'GET' });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(handleWebsiteUpdateMock).toHaveBeenCalledTimes(1);
		expect(handleTelegramUpdateMock).not.toHaveBeenCalled();
		expect(await response.text()).toBe('site-ok');
	});

	it('routes everything else to the website handler', async () => {
		handleWebsiteUpdateMock.mockResolvedValueOnce(new Response('site-ok'));
		vi.resetModules();
		const worker = (await import('../src/index.js')).default;

		const request = new Request('http://example.com/about');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(handleWebsiteUpdateMock).toHaveBeenCalledTimes(1);
		expect(handleTelegramUpdateMock).not.toHaveBeenCalled();
		expect(await response.text()).toBe('site-ok');
	});

	it('catches an unhandled error, reports it, and returns 500', async () => {
		handleWebsiteUpdateMock.mockRejectedValueOnce(new Error('boom'));
		vi.resetModules();
		const worker = (await import('../src/index.js')).default;

		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(500);
		expect(reportErrorToAdminMock).toHaveBeenCalledWith(expect.anything(), 'Worker.fetch', expect.any(Error));
	});
});

describe('Worker.scheduled (cron router)', () => {
	const worker = async () => {
		vi.resetModules();
		return (await import('../src/index.js')).default;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		publishDuePostsMock.mockResolvedValue({});
		runScheduledCleanupMock.mockResolvedValue(undefined);
		refreshChannelAdminsMock.mockResolvedValue(undefined);
	});

	it('routes the publish-queue cron to the queue, not to cleanup', async () => {
		const app = await worker();
		const ctx = createExecutionContext();

		await app.scheduled({ cron: '* * * * *' }, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(publishDuePostsMock).toHaveBeenCalledTimes(1);
		expect(runScheduledCleanupMock).not.toHaveBeenCalled();
	});

	it('routes the daily cron to cleanup and the admin sync cron to the sync job', async () => {
		const app = await worker();

		const cleanupCtx = createExecutionContext();
		await app.scheduled({ cron: '30 23 * * *' }, env, cleanupCtx);
		await waitOnExecutionContext(cleanupCtx);
		expect(runScheduledCleanupMock).toHaveBeenCalledTimes(1);

		const syncCtx = createExecutionContext();
		await app.scheduled({ cron: '30 14 * * *' }, env, syncCtx);
		await waitOnExecutionContext(syncCtx);
		expect(refreshChannelAdminsMock).toHaveBeenCalledTimes(1);

		expect(publishDuePostsMock).not.toHaveBeenCalled();
	});

	it('regression: an unknown cron runs nothing (previously it ran the cleanup)', async () => {
		const app = await worker();
		const ctx = createExecutionContext();

		await app.scheduled({ cron: '0 0 1 1 *' }, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(runScheduledCleanupMock).not.toHaveBeenCalled();
		expect(publishDuePostsMock).not.toHaveBeenCalled();
		expect(refreshChannelAdminsMock).not.toHaveBeenCalled();
	});

	it('reports a failing cron instead of crashing', async () => {
		publishDuePostsMock.mockRejectedValueOnce(new Error('boom'));
		const app = await worker();
		const ctx = createExecutionContext();

		await app.scheduled({ cron: '* * * * *' }, env, ctx);
		await waitOnExecutionContext(ctx);

		// محیط (env) شامل D1 است و مقایسه‌ی کل شیء باعث خطای سریال‌سازی می‌شود؛
		// پس فقط نام کار و نوع خطا را بررسی می‌کنیم.
		expect(reportErrorToAdminMock).toHaveBeenCalledTimes(1);
		expect(reportErrorToAdminMock.mock.calls[0][1]).toBe('cron:* * * * *');
		expect(reportErrorToAdminMock.mock.calls[0][2]).toBeInstanceOf(Error);
	});
});

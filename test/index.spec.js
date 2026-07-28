import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExecutionContext, waitOnExecutionContext, env } from 'cloudflare:test';

// از vi.hoisted استفاده می‌کنیم چون vi.mock به بالای فایل hoist می‌شه؛
// اگه mock function‌ها رو مستقیم با const بسازیم، هنگام اجرای factory
// هنوز initialize نشدن (خطای "Cannot access before initialization").
const { handleTelegramUpdateMock, handleWebsiteUpdateMock, reportErrorToAdminMock } = vi.hoisted(() => ({
	handleTelegramUpdateMock: vi.fn(),
	handleWebsiteUpdateMock: vi.fn(),
	reportErrorToAdminMock: vi.fn(),
}));

vi.mock('../src/telegram/main-tel.js', () => ({
	handleTelegramUpdate: handleTelegramUpdateMock,
}));
vi.mock('../src/website/main-web.js', () => ({
	handleWebsiteUpdate: handleWebsiteUpdateMock,
}));
vi.mock('../src/telegram/utils/Error.js', () => ({
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

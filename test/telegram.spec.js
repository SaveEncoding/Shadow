import { describe, it, expect, vi, beforeEach } from 'vitest';

// از vi.hoisted استفاده می‌کنیم تا با hoist شدن vi.mock به بالای فایل مشکلی پیش نیاد
const { mockWebhookHandler, createBotMock, startCommandMock, echoMock, reportErrorToAdminMock } = vi.hoisted(() => ({
	mockWebhookHandler: vi.fn(),
	createBotMock: vi.fn(() => ({ __fakeBot: true })),
	startCommandMock: vi.fn(),
	echoMock: vi.fn(),
	reportErrorToAdminMock: vi.fn(),
}));

vi.mock('grammy', () => ({
	webhookCallback: vi.fn(() => mockWebhookHandler),
}));
vi.mock('../src/telegram/bot.js', () => ({
	createBot: createBotMock,
}));
vi.mock('../src/telegram/commands/start.js', () => ({
	startCommand: startCommandMock,
}));
vi.mock('../src/telegram/services/echoFun.js', () => ({
	echo: echoMock,
}));
vi.mock('../src/telegram/utils/Error.js', () => ({
	reportErrorToAdmin: reportErrorToAdminMock,
}));

const fakeEnv = {};

function makeUpdateRequest(body) {
	return new Request('http://example.com/telegram', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'Content-Type': 'application/json' },
	});
}

describe('handleTelegramUpdate', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it('creates the bot, registers features once, and forwards the request on success', async () => {
		const { handleTelegramUpdate } = await import('../src/telegram/main-tel.js');
		mockWebhookHandler.mockResolvedValueOnce(new Response('ok', { status: 200 }));

		const request = makeUpdateRequest({ update_id: 1, message: { from: { id: 111 }, text: 'hi' } });
		const response = await handleTelegramUpdate(request, fakeEnv);

		expect(response.status).toBe(200);
		expect(createBotMock).toHaveBeenCalledWith(fakeEnv);
		expect(startCommandMock).toHaveBeenCalled();
		expect(echoMock).toHaveBeenCalled();
		expect(mockWebhookHandler).toHaveBeenCalledTimes(1);
	});

	it('reuses the same bot/handler across multiple requests instead of rebuilding it each time', async () => {
		const { handleTelegramUpdate } = await import('../src/telegram/main-tel.js');
		mockWebhookHandler.mockResolvedValue(new Response('ok', { status: 200 }));

		await handleTelegramUpdate(makeUpdateRequest({ update_id: 1 }), fakeEnv);
		await handleTelegramUpdate(makeUpdateRequest({ update_id: 2 }), fakeEnv);
		await handleTelegramUpdate(makeUpdateRequest({ update_id: 3 }), fakeEnv);

		// createBot/startCommand/echo باید فقط یک‌بار در هر isolate اجرا بشن، نه یک‌بار به‌ازای هر ریکوئست
		expect(createBotMock).toHaveBeenCalledTimes(1);
		expect(startCommandMock).toHaveBeenCalledTimes(1);
		expect(echoMock).toHaveBeenCalledTimes(1);
		expect(mockWebhookHandler).toHaveBeenCalledTimes(3);
	});

	it('regression: still reports the error correctly even though the handler already consumed the body', async () => {
		const { handleTelegramUpdate } = await import('../src/telegram/main-tel.js');
		// mock handler دقیقاً مثل webhookCallback واقعی grammy، خودش body رو می‌خونه و بعد throw می‌کنه.
		// اگه request قبل از این فراخوانی clone نشده باشه، خوندنش برای گزارش خطا با
		// "Body has already been used" خطا می‌ده.
		mockWebhookHandler.mockImplementationOnce(async (request) => {
			await request.json();
			throw new Error('boom');
		});

		const request = makeUpdateRequest({ update_id: 2, message: { from: { id: 222 }, text: 'hi' } });
		const response = await handleTelegramUpdate(request, fakeEnv);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK');
		expect(reportErrorToAdminMock).toHaveBeenCalledWith(fakeEnv, 'handleTelegramUpdate', expect.any(Error), 222);
	});

	it('does not report an error when the failed update has no identifiable user', async () => {
		const { handleTelegramUpdate } = await import('../src/telegram/main-tel.js');
		mockWebhookHandler.mockRejectedValueOnce(new Error('boom'));

		const request = makeUpdateRequest({ update_id: 3 });
		const response = await handleTelegramUpdate(request, fakeEnv);

		expect(response.status).toBe(200);
		expect(reportErrorToAdminMock).not.toHaveBeenCalled();
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We use vi.hoisted to avoid issues caused by vi.mock being hoisted to the top of the file.
const { mockWebhookHandler, createBotMock, startCommandMock, channelsFeatureMock, echoMock, reportErrorToAdminMock } =
	vi.hoisted(() => ({
		mockWebhookHandler: vi.fn(),
		createBotMock: vi.fn(() => ({ __fakeBot: true })),
		startCommandMock: vi.fn(),
		channelsFeatureMock: vi.fn(),
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
vi.mock('../src/telegram/features/channels.js', () => ({
	channelsFeature: channelsFeatureMock,
}));
vi.mock('../src/telegram/services/echoFun.js', () => ({
	echo: echoMock,
}));
vi.mock('../src/telegram/utils/Error.js', () => ({
	reportErrorToAdmin: reportErrorToAdminMock,
}));

const fakeEnv = { TELEGRAM_WEBHOOK_SECRET: "test-secret" };

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
		expect(channelsFeatureMock).toHaveBeenCalled();
		expect(echoMock).toHaveBeenCalled();
		expect(mockWebhookHandler).toHaveBeenCalledTimes(1);
	});

	it('reuses the same bot/handler across multiple requests instead of rebuilding it each time', async () => {
		const { handleTelegramUpdate } = await import('../src/telegram/main-tel.js');
		mockWebhookHandler.mockResolvedValue(new Response('ok', { status: 200 }));

		await handleTelegramUpdate(makeUpdateRequest({ update_id: 1 }), fakeEnv);
		await handleTelegramUpdate(makeUpdateRequest({ update_id: 2 }), fakeEnv);
		await handleTelegramUpdate(makeUpdateRequest({ update_id: 3 }), fakeEnv);

		// createBot/startCommand/channelsFeature/echo باید فقط یک‌بار در هر isolate اجرا بشن، نه یک‌بار به‌ازای هر ریکوئست
		expect(createBotMock).toHaveBeenCalledTimes(1);
		expect(startCommandMock).toHaveBeenCalledTimes(1);
		expect(channelsFeatureMock).toHaveBeenCalledTimes(1);
		expect(echoMock).toHaveBeenCalledTimes(1);
		expect(mockWebhookHandler).toHaveBeenCalledTimes(3);
	});

	it('regression: still reports the error correctly even though the handler already consumed the body', async () => {
		const { handleTelegramUpdate } = await import('../src/telegram/main-tel.js');
		// The mock handler, just like the real webhookCallback, reads its body and then throws an error.
		// If the request was not cloned before this call, reading it for error reporting
		// results in a "body already used" error.
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

	it('refuses to build the handler when TELEGRAM_WEBHOOK_SECRET is missing', async () => {
		const { handleTelegramUpdate } = await import('../src/telegram/main-tel.js');
		const envWithoutSecret = {};

		const request = makeUpdateRequest({ update_id: 4, message: { from: { id: 444 } } });
		const response = await handleTelegramUpdate(request, envWithoutSecret);

		expect(response.status).toBe(200); // caught and reported, not thrown to the caller
		expect(mockWebhookHandler).not.toHaveBeenCalled();
		expect(reportErrorToAdminMock).toHaveBeenCalledWith(
			envWithoutSecret,
			'handleTelegramUpdate',
			expect.any(Error),
			444
		);
	});
});

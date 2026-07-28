import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';

describe('Worker', () => {
	it('returns health JSON', async () => {
		const request = new Request('http://example.com/health');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it('forwards non-API requests to ASSETS.fetch', async () => {
		const envWithAssets = {
			...env,
			ASSETS: {
				fetch: async () => new Response('static content', { status: 200 })
			}
		};
		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, envWithAssets, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('static content');
	});
});

import { describe, it, expect } from 'vitest';
import { handleWebsiteUpdate } from '../src/website/main-web.js';

describe('handleWebsiteUpdate', () => {
	it('serves the home page at "/"', async () => {
		const response = await handleWebsiteUpdate(new Request('http://example.com/'), {});
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/html');
	});

	it('301-redirects the old ".html" URL to its canonical clean URL', async () => {
		const response = await handleWebsiteUpdate(new Request('http://example.com/about.html'), {});
		expect(response.status).toBe(301);
		expect(response.headers.get('Location')).toBe('http://example.com/about');
	});

	it('preserves the query string when redirecting to the canonical URL', async () => {
		const response = await handleWebsiteUpdate(new Request('http://example.com/about.html?ref=telegram'), {});
		expect(response.status).toBe(301);
		expect(response.headers.get('Location')).toBe('http://example.com/about?ref=telegram');
	});

	it('normalizes a trailing slash', async () => {
		const response = await handleWebsiteUpdate(new Request('http://example.com/telegram/'), {});
		expect(response.status).toBe(200);
	});

	it('serves the bundled image with the correct content type and long-term cache header', async () => {
		const response = await handleWebsiteUpdate(new Request('http://example.com/image-1.jpg'), {});
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('image/jpeg');
		expect(response.headers.get('Cache-Control')).toContain('immutable');
	});

	it('serves robots.txt', async () => {
		const response = await handleWebsiteUpdate(new Request('http://example.com/robots.txt'), {});
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/plain');
		expect(await response.text()).toContain('User-agent: *');
	});

	it('returns the custom 404 page for an unknown path', async () => {
		const response = await handleWebsiteUpdate(new Request('http://example.com/does-not-exist'), {});
		expect(response.status).toBe(404);
		expect(response.headers.get('Content-Type')).toContain('text/html');
	});

	it('returns an empty body for HEAD requests but keeps the same status/headers', async () => {
		const getResponse = await handleWebsiteUpdate(new Request('http://example.com/'), {});
		const headResponse = await handleWebsiteUpdate(new Request('http://example.com/', { method: 'HEAD' }), {});
		expect(headResponse.status).toBe(getResponse.status);
		expect(headResponse.headers.get('Content-Type')).toBe(getResponse.headers.get('Content-Type'));
		expect(await headResponse.text()).toBe('');
	});

	it('rejects methods other than GET/HEAD with 405', async () => {
		const response = await handleWebsiteUpdate(new Request('http://example.com/', { method: 'POST' }), {});
		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('GET, HEAD');
	});

	it('applies the baseline security headers to every response', async () => {
		const response = await handleWebsiteUpdate(new Request('http://example.com/'), {});
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
		expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
	});
});

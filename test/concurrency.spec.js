import { describe, it, expect } from 'vitest';
import { DEFAULT_NETWORK_CONCURRENCY, mapLimit } from '../src/core/util/concurrency.js';

describe('mapLimit', () => {
	it('returns an empty array for no work', async () => {
		expect(await mapLimit([], 3, async () => 1)).toEqual([]);
	});

	it('preserves input order even when work finishes out of order', async () => {
		const delays = [30, 5, 15, 1];
		const result = await mapLimit([0, 1, 2, 3], 3, async (item) => {
			await new Promise((resolve) => setTimeout(resolve, delays[item]));
			return `item-${item}`;
		});
		expect(result).toEqual(['item-0', 'item-1', 'item-2', 'item-3']);
	});

	it('never runs more than the limit at once', async () => {
		let inFlight = 0;
		let peak = 0;
		await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 10));
			inFlight--;
		});
		expect(peak).toBe(3);
	});

	it('clamps a silly limit instead of spawning unbounded work', async () => {
		let peak = 0;
		let inFlight = 0;
		await mapLimit([1, 2], 0, async () => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			inFlight--;
		});
		expect(peak).toBe(1);
	});

	it('lets the rest finish, then reports the first failure', async () => {
		const done = [];
		await expect(
			mapLimit([1, 2, 3, 4], 2, async (item) => {
				if (item === 2) throw new Error('boom');
				await new Promise((resolve) => setTimeout(resolve, 10));
				done.push(item);
			}),
		).rejects.toThrow('boom');
		// کارهای دیگر متوقف نشدند (۴ و ۱ تمام شدند؛ ۳ هم ادامه یافت)
		expect(done.length).toBeGreaterThanOrEqual(2);
	});

	it('keeps the documented network concurrency at or under the Workers connection cap', () => {
		// مستندات Workers: حداکثر ۶ اتصال بازِ هم‌زمان در هر invocation
		expect(DEFAULT_NETWORK_CONCURRENCY).toBeLessThan(6);
	});
});

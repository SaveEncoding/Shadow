/**
 * حداقل چیزی که این تابع از env لازم دارد. عمداً `Env` کامل نیست تا تست‌ها
 * بتوانند فقط همین یک کلید را بدهند و به کل ساختار بایندینگ‌ها وابسته نشوند.
 */
export interface FounderEnv {
	FOUNDER_TELEGRAM_ID?: string | null;
}

/**
 * Resolve founder telegram id from the Worker env secret.
 * There is no code-level fallback on purpose — the founder identity
 * lives only in the `FOUNDER_TELEGRAM_ID` secret/env var per deployment.
 */
export function resolveFounderId(env: FounderEnv | null | undefined): number | null {
	if (env?.FOUNDER_TELEGRAM_ID != null && env.FOUNDER_TELEGRAM_ID !== '') {
		const n = Number(env.FOUNDER_TELEGRAM_ID);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

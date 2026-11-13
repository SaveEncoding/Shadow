/**
 * کلیدهای خاموش/روشن کردن «پیام‌های خبری» کرون در گپ لاگ.
 *
 * چرا در D1 (`bot_settings`) و نه env؟ چون باید از داخل خود بات و با دکمه
 * عوض شود، بدون deploy دوباره؛ و چون هر اجرای کرون در ایزوله‌ی تازه‌ای بالا
 * می‌آید، حافظه‌ی داخل پروسه برای چنین تنظیمی قابل اتکا نیست.
 *
 * این ماژول **خالص** است: هیچ D1 و هیچ grammy ای نمی‌شناسد. لایه‌ی db فقط
 * ردیف‌ها را می‌خواند/می‌نویسد و لایه‌ی ui فقط وضعیت را نشان می‌دهد.
 *
 * نکته‌ی مهم درباره‌ی معنا: خاموش‌کردن این کلیدها فقط **پیام** را قطع می‌کند؛
 * خودِ کار زمان‌بندی‌شده (پاک‌سازی کاربران غیرفعال، همگام‌سازی ادمین‌های کانال)
 * مثل قبل اجرا می‌شود. این عمدی است: خاموشی اعلان نباید بی‌صدا بودنِ کار را
 * به همراه داشته باشد.
 */

/** کرون‌هایی که پیام گزارشی‌شان قابل خاموش/روشن شدن است */
export const CRON_NOTIFY_KEYS = ['cleanup', 'admin_sync'] as const;

export type CronNotifyKey = (typeof CRON_NOTIFY_KEYS)[number];

/** کلید اصلی؛ اگر خاموش باشد هیچ‌کدام از پیام‌ها نمی‌روند */
export const SETTING_CRON_NOTIFY_MASTER = 'cron_notify_master';

/** کلید تنظیم هر کرون در `bot_settings` */
export function cronNotifyItemSettingKey(key: CronNotifyKey): string {
	return `cron_notify:${key}`;
}

/** همه‌ی کلیدهایی که یک اجرای کرون لازم دارد (برای یک SELECT با IN) */
export const CRON_NOTIFY_SETTING_KEYS: readonly string[] = [SETTING_CRON_NOTIFY_MASTER, ...CRON_NOTIFY_KEYS.map(cronNotifyItemSettingKey)];

export interface CronNotifyState {
	/** «همه اعلان‌های خودکار» */
	master: boolean;
	/** وضعیت ذخیره‌شده‌ی هر کرون (مستقل از کلید اصلی) */
	items: Record<CronNotifyKey, boolean>;
}

/**
 * پیش‌فرض: همه روشن.
 * رفتار ربات پیش از افزودن این دکمه دقیقاً همین بود؛ پس نبودِ ردیف در
 * `bot_settings` نباید بعد از deploy بی‌صدا اعلان‌ها را قطع کند.
 */
export const DEFAULT_CRON_NOTIFY_STATE: CronNotifyState = {
	master: true,
	items: { cleanup: true, admin_sync: true },
};

/** آیا رشته‌ی ذخیره‌شده یعنی «روشن»؟ هر مقدار ناشناخته → null (تنظیم‌نشده) */
export function parseNotifyFlag(raw: string | null | undefined): boolean | null {
	if (raw === null || raw === undefined) return null;
	switch (raw.trim().toLowerCase()) {
		case '1':
		case 'true':
		case 'on':
		case 'yes':
			return true;
		case '0':
		case 'false':
		case 'off':
		case 'no':
			return false;
		default:
			return null;
	}
}

/** وضعیت را از ردیف‌های `bot_settings` می‌سازد؛ ردیف ناموجود = پیش‌فرض */
export function cronNotifyStateFromRows(rows: ReadonlyArray<{ key: string; value: string }>): CronNotifyState {
	const values = new Map(rows.map((row) => [row.key, row.value]));
	const items: Record<CronNotifyKey, boolean> = { ...DEFAULT_CRON_NOTIFY_STATE.items };

	for (const key of CRON_NOTIFY_KEYS) {
		const parsed = parseNotifyFlag(values.get(cronNotifyItemSettingKey(key)));
		if (parsed !== null) items[key] = parsed;
	}

	const master = parseNotifyFlag(values.get(SETTING_CRON_NOTIFY_MASTER)) ?? DEFAULT_CRON_NOTIFY_STATE.master;
	return { master, items };
}

/** آیا پیام این کرون باید فرستاده شود؟ کلید اصلی بر همه مقدم است. */
export function isCronNotifyEnabled(state: CronNotifyState, key: CronNotifyKey): boolean {
	return state.master && state.items[key];
}

export type CronNotifyTarget = 'master' | CronNotifyKey;

/** نوع‌گارد callback_data → هدف قابل اعتماد */
export function isCronNotifyTarget(value: string | null | undefined): value is CronNotifyTarget {
	if (value === 'master') return true;
	return (CRON_NOTIFY_KEYS as readonly string[]).includes(value ?? '');
}

/** وضعیت جدید پس از عوض‌کردن یک کلید (بدون دست‌زدن به ورودی) */
export function withCronNotifyFlag(state: CronNotifyState, target: CronNotifyTarget, enabled: boolean): CronNotifyState {
	if (target === 'master') return { master: enabled, items: { ...state.items } };
	return { master: state.master, items: { ...state.items, [target]: enabled } };
}

/** خواندن وضعیت فعلی یک هدف از وضعیت کلی (برای دکمه‌ی toggle) */
export function cronNotifyFlag(state: CronNotifyState, target: CronNotifyTarget): boolean {
	return target === 'master' ? state.master : state.items[target];
}

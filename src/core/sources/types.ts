/**
 * انواع مشترک «منبع بیرونی» (وب‌سایت‌های دیگر).
 *
 * فیچر زمان‌بندی پست تا امروز دو جور منبع داشت: کانالی که بات ادمینش است
 * (webhook) و کانال عمومی (پیش‌نمایش وب تلگرام). این فایل قرارداد یک منبع
 * بیرونی مثل X را تعریف می‌کند تا افزودن پلتفرم بعدی فقط یک پارسر + یک آداپتور
 * شبکه باشد، نه دست‌زدن به صف/انتشار/UI.
 */

/** پلتفرم‌هایی که پشتیبانی می‌شوند */
export type ExternalKind = 'x';

export type ExternalMedia = {
	kind: 'photo' | 'video';
	/** لینک مستقیم رسانه (برای عکس: pbs.twimg.com؛ برای ویدیو: HLS) */
	url: string;
	/** تصویر بندانگشتی ویدیو (اگر باشد) */
	thumbnailUrl?: string | null;
	width?: number | null;
	height?: number | null;
};

/** یک پست بیرونی، مستقل از پلتفرم */
export interface ExternalPost {
	/** شناسه‌ی متنی در پلتفرم مبدأ (مثلاً شناسه‌ی توییت) */
	externalId: string;
	/** متن کامل پست (بدون هیچ تگ) */
	text: string;
	media: ExternalMedia[];
	/** زمان انتشار (ثانیه‌ی یونیکس) — اگر پلتفرم بدهد */
	createdAt: number | null;
	/** لینک عمومی اصل پست */
	url: string;
	/** اگر محتوای پستی قابل کپی نیست، دلیل فارسی؛ وگرنه null */
	unsupported: string | null;
	/**
	 * پست ویدیو داشت ولی فایل مستقیمش در دسترس نبود (X فقط HLS می‌دهد).
	 * در این حالت متن کپی می‌شود و لینک اصل پست به آن اضافه می‌شود.
	 */
	videoDropped?: boolean;
}

/** نتیجه‌ی یک بار خواندن خط زمانی */
export type ExternalFetchResult =
	{ ok: true; posts: ExternalPost[]; handle: string; cursor: string | null } | { ok: false; error: string; status: number | null };

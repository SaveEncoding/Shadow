/**
 * انواع مشترک فیچر «کپی و زمان‌بندی پست».
 * این فایل هیچ وابستگی‌ای ندارد؛ هم D1 و هم تلگرام از همین انواع استفاده می‌کنند.
 */

/** نوع محتوای یک آیتم پست */
export type ItemKind = 'text' | 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'animation' | 'sticker' | 'unsupported';

/** وضعیت یک پست در صف */
export type QueueStatus = 'collecting' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'canceled';

export const PAUSED_STATUSES: ReadonlyArray<QueueStatus> = ['published', 'failed', 'canceled'];

/** یک آیتم (یک پیام تلگرام) داخل یک پست */
export interface PostItem {
	/** شناسه‌ی پیام در کانال مبدأ (برای مرتب‌سازی و حذف تکراری) */
	sourceMessageId: number;
	kind: ItemKind;
	/** file_id تلگرام برای رسانه‌ها — همان چیزی که در زمان انتشار دوباره فرستاده می‌شود */
	fileId: string | null;
	/** متن (برای پست متنی) یا کپشن (برای رسانه) */
	text: string | null;
	/** JSON entities تلگرام؛ برای اینکه بولد/لینک/اسپویلر حفظ شود */
	entities: unknown[] | null;
	/** فراداده‌ی لازم برای ارسال (مثلاً عرض/ارتفاع ویدیو) */
	extra: Record<string, unknown> | null;
}

/** یک پست کامل در صف */
export interface QueuePost {
	id: number;
	/** ۰ برای پست دستی (فورواردشده) */
	sourceChannelId: number;
	/** عنوان/یوزرنیم مبدأ — فقط برای نمایش در UI */
	sourceTitle: string | null;
	sourceUsername: string | null;
	targetChannelId: number;
	mediaGroupId: string | null;
	status: QueueStatus;
	/** زمان انتشار (ثانیه‌ی یونیکس) */
	publishAt: number;
	/** برای آلبوم‌ها: زمانی که پس از آن، پست نهایی می‌شود */
	finalizeAt: number | null;
	createdAt: number;
	updatedAt: number;
	publishedAt: number | null;
	publishedMessageId: number | null;
	attempts: number;
	lastError: string | null;
	createdBy: number | null;
	/** پیام پیش‌نمایشی که برای ادمین فرستادیم (برای ویرایش همان پیام) */
	previewChatId: number | null;
	previewMessageId: number | null;
	/** true وقتی ادمین متن/کپشن را دستی تغییر داده است */
	edited: boolean;
	items: PostItem[];
}

/** قانون «هر پست جدید کانال مبدأ → کانال مقصد با این تأخیر» */
export interface SourceRule {
	id: number;
	sourceChannelId: number;
	/** عنوان کانال مبدأ برای نمایش در UI */
	sourceTitle: string | null;
	sourceUsername: string | null;
	targetChannelId: number;
	delayMinutes: number;
	enabled: boolean;
	/** چتی که اعلان/پیش‌نمایش در آن فرستاده می‌شود (معمولاً چت خصوصی سازنده) */
	notifyChatId: number | null;
	/**
	 * اگر پر باشد، این منبع از **پیش‌نمایش وب** خوانده می‌شود (بات عضو/ادمینش نیست)
	 * و مقدارش نام کاربری کانال است. `null` یعنی حالت ادمین (webhook).
	 */
	pollUsername: string | null;
	addedBy: number;
	createdAt: number;
}

/** وضعیتی که منتظر متن ادمین است */
export interface EditSession {
	id: number;
	postId: number;
	userId: number;
	chatId: number;
	messageId: number;
	field: 'text' | 'caption';
	/** فقط آیتم اول قابل ویرایش کپشن است (v1) */
	targetMessageId: number;
	expiresAt: number;
}

/** نتیجه‌ی هر تلاش برای انتشار */
export interface PublishResult {
	ok: boolean;
	messageId: number | null;
	error: string | null;
	/** وقتی خطا از طرف تلگرام است: کد خطا (مثلاً 403) */
	errorCode: number | null;
}

/**
 * گرفتن پست‌های کانال مبدأ و ریختن آن‌ها در صف انتشار.
 *
 * دو نکته‌ی مهم که این فایل را از یک «کپی ساده» جدا می‌کند:
 *
 * ۱. **آلبوم‌ها**: تلگرام هر آیتم یک آلبوم را در یک update جدا می‌فرستد.
 *    همه‌ی آیتم‌ها با `media_group_id` یکی می‌شوند و تا `ALBUM_GRACE_SECONDS`
 *    بعد «جمع‌آوری» می‌مانند؛ کرون بعد از آن پست را نهایی می‌کند.
 *
 * ۲. **تکرار (retry)**: تلگرام اگر پاسخ ما دیر شود همان update را دوباره می‌فرستد.
 *    جدول `post_seen` جلوی ساخت پست تکراری را می‌گیرد.
 */

import { ALBUM_GRACE_SECONDS, computePublishAt } from '../core/schedule/timing.js';
import type { ItemKind, PostItem, SourceRule } from '../core/schedule/types.js';
import {
	appendItem,
	createQueuedPost,
	finalizePost,
	findCollectingPost,
	findItemBySourceMessage,
	markMessageSeen,
	updateItemContent,
	getSourceRule,
} from './db/postQueue.js';

/** حداقل شکل پیامی که از تلگرام می‌آید (فقط چیزی که استفاده می‌کنیم) */
export interface TelegramPostMessage {
	message_id: number;
	chat: { id: number; type?: string; title?: string; username?: string };
	media_group_id?: string;
	text?: string;
	entities?: unknown[];
	caption?: string;
	caption_entities?: unknown[];
	photo?: Array<{ file_id: string; width: number; height: number }>;
	video?: { file_id: string; width?: number; height?: number; duration?: number };
	document?: { file_id: string; file_name?: string };
	audio?: { file_id: string; duration?: number; title?: string };
	voice?: { file_id: string; duration?: number };
	animation?: { file_id: string; width?: number; height?: number; duration?: number };
	sticker?: { file_id: string };
	poll?: unknown;
	location?: unknown;
	contact?: unknown;
	dice?: unknown;
	venue?: unknown;
	game?: unknown;
}

/** نوع پست‌هایی که در نسخه‌ی اول پشتیبانی نمی‌شوند */
export function unsupportedReason(message: TelegramPostMessage): string | null {
	if (message.poll) return 'نظرسنجی (poll)';
	if (message.location || message.venue) return 'موقعیت مکانی';
	if (message.contact) return 'مخاطب (contact)';
	if (message.dice) return 'تاس/انیمیشن تعاملی';
	if (message.game) return 'بازی تلگرامی';
	return null;
}

/**
 * تبدیل یک پیام تلگرام به آیتم قابل ذخیره.
 * برای رسانه‌ها بزرگ‌ترین نسخه‌ی عکس انتخاب می‌شود (تلگرام نسخه‌های متعدد می‌دهد).
 */
export function extractPostItem(message: TelegramPostMessage): PostItem | null {
	const base = { sourceMessageId: Number(message.message_id) };

	if (message.text && message.text.trim()) {
		return {
			...base,
			kind: 'text',
			fileId: null,
			text: message.text,
			entities: message.entities ?? null,
			extra: null,
		};
	}

	if (message.photo && message.photo.length > 0) {
		const best = message.photo[message.photo.length - 1];
		return {
			...base,
			kind: 'photo',
			fileId: best.file_id,
			text: message.caption ?? null,
			entities: message.caption_entities ?? null,
			extra: { width: best.width, height: best.height },
		};
	}

	if (message.video?.file_id) {
		return {
			...base,
			kind: 'video',
			fileId: message.video.file_id,
			text: message.caption ?? null,
			entities: message.caption_entities ?? null,
			extra: {
				width: message.video.width ?? null,
				height: message.video.height ?? null,
				duration: message.video.duration ?? null,
			},
		};
	}

	if (message.animation?.file_id) {
		return {
			...base,
			kind: 'animation',
			fileId: message.animation.file_id,
			text: message.caption ?? null,
			entities: message.caption_entities ?? null,
			extra: {
				width: message.animation.width ?? null,
				height: message.animation.height ?? null,
				duration: message.animation.duration ?? null,
			},
		};
	}

	if (message.document?.file_id) {
		return {
			...base,
			kind: 'document',
			fileId: message.document.file_id,
			text: message.caption ?? null,
			entities: message.caption_entities ?? null,
			extra: { file_name: message.document.file_name ?? null },
		};
	}

	if (message.audio?.file_id) {
		return {
			...base,
			kind: 'audio',
			fileId: message.audio.file_id,
			text: message.caption ?? null,
			entities: message.caption_entities ?? null,
			extra: { duration: message.audio.duration ?? null, title: message.audio.title ?? null },
		};
	}

	if (message.voice?.file_id) {
		return {
			...base,
			kind: 'voice',
			fileId: message.voice.file_id,
			text: message.caption ?? null,
			entities: message.caption_entities ?? null,
			extra: { duration: message.voice.duration ?? null },
		};
	}

	if (message.sticker?.file_id) {
		return {
			...base,
			kind: 'sticker',
			fileId: message.sticker.file_id,
			text: null,
			entities: null,
			extra: null,
		};
	}

	return null;
}

export type CaptureOutcome =
	| { action: 'no-rule' }
	| { action: 'duplicate' }
	| { action: 'unsupported'; reason: string }
	| { action: 'collecting'; postId: number; rule: SourceRule }
	| { action: 'queued'; postId: number; publishAt: number; rule: SourceRule; isNew: boolean };

/**
 * پردازش یک پست تازه‌ی کانال مبدأ.
 * @param db
 * @param message پیام کانال (channel_post)
 * @param now ثانیه‌ی یونیکس
 */
export async function captureSourcePost(
	db: D1Database,
	message: TelegramPostMessage,
	now: number,
): Promise<CaptureOutcome> {
	const sourceChannelId = Number(message.chat?.id);
	if (!sourceChannelId) return { action: 'no-rule' };

	const rule = await getSourceRule(db, sourceChannelId);
	if (!rule || !rule.enabled) return { action: 'no-rule' };

	const unsupported = unsupportedReason(message);
	if (unsupported) return { action: 'unsupported', reason: unsupported };

	const item = extractPostItem(message);
	if (!item) return { action: 'unsupported', reason: 'نوع ناشناخته' };

	// تکرار وبهوک: همین پیام قبلاً ثبت شده است
	if (!(await markMessageSeen(db, sourceChannelId, Number(message.message_id), now))) {
		return { action: 'duplicate' };
	}

	const mediaGroupId = message.media_group_id ?? null;

	let postId: number | null = null;
	let isNew = false;

	if (mediaGroupId) {
		postId = await findCollectingPost(db, sourceChannelId, mediaGroupId);
	}
	if (!postId) {
		postId = await createQueuedPost(db, {
			sourceChannelId,
			sourceTitle: rule.sourceTitle,
			sourceUsername: rule.sourceUsername,
			targetChannelId: rule.targetChannelId,
			mediaGroupId,
			// پیش‌نمایش به همان چتی می‌رود که قانون از آن ساخته شده (اگر ثبت شده باشد)
			createdBy: rule.notifyChatId ?? rule.addedBy,
			now,
		});
		isNew = true;
	}

	const appended = await appendItem(db, postId, item, now, mediaGroupId ? now + ALBUM_GRACE_SECONDS : now);
	if (!appended) return { action: 'duplicate' };

	if (mediaGroupId) {
		// منتظر می‌مانیم تا بقیه‌ی آیتم‌های آلبوم برسند؛ کرون نهایی‌اش می‌کند.
		return { action: 'collecting', postId, rule };
	}

	const publishAt = computePublishAt(now, rule.delayMinutes);
	const finalized = await finalizePost(db, postId, publishAt, now);
	if (!finalized) return { action: 'duplicate' };

	return { action: 'queued', postId, publishAt, rule, isNew };
}

export type EditOutcome =
	| { action: 'ignored' }
	| { action: 'updated'; postId: number; published: boolean; text: string | null }
	| { action: 'unsupported'; reason: string };

/**
 * وقتی پست مبدأ ویرایش می‌شود:
 *  - اگر هنوز منتشر نشده: متن/کپشن صف به‌روز می‌شود (ادمین چیزی را از دست نمی‌دهد).
 *  - اگر منتشر شده: فقط گزارش می‌دهیم؛ ویرایش پست منتشرشده تصمیم جداگانه‌ی ادمین است.
 */
export async function applySourceEdit(
	db: D1Database,
	message: TelegramPostMessage,
	now: number,
): Promise<EditOutcome> {
	const sourceChannelId = Number(message.chat?.id);
	if (!sourceChannelId) return { action: 'ignored' };

	const found = await findItemBySourceMessage(db, sourceChannelId, Number(message.message_id));
	if (!found) return { action: 'ignored' };

	const { post, item } = found;
	const isTextPost = item.kind === 'text';
	const text = isTextPost ? (message.text ?? null) : (message.caption ?? null);
	const entities = isTextPost ? (message.entities ?? null) : (message.caption_entities ?? null);

	if (text === null) return { action: 'ignored' };

	await updateItemContent(db, post.id, item.sourceMessageId, { text, entities }, now);

	return {
		action: 'updated',
		postId: post.id,
		published: post.status === 'published',
		text,
	};
}

/**
 * ثبت یک پست دستی (فوروارد ادمین به بات) در صف.
 * کانال مبدأ ۰ ذخیره می‌شود چون پستی وجود ندارد که بخواهیم دنبالش کنیم.
 */
export async function queueManualPost(
	db: D1Database,
	items: PostItem[],
	options: { targetChannelId: number; delayMinutes: number; createdBy: number; now: number },
): Promise<{ postId: number; publishAt: number } | null> {
	if (items.length === 0) return null;

	const postId = await createQueuedPost(db, {
		sourceChannelId: 0,
		sourceTitle: null,
		sourceUsername: null,
		targetChannelId: options.targetChannelId,
		mediaGroupId: null,
		createdBy: options.createdBy,
		now: options.now,
	});

	for (const item of items) {
		await appendItem(db, postId, item, options.now);
	}

	const publishAt = computePublishAt(options.now, options.delayMinutes);
	const finalized = await finalizePost(db, postId, publishAt, options.now);
	return finalized ? { postId, publishAt } : null;
}

/** آیتم «خالی» (مثلاً پیامی که فقط استیکر دارد و...) را رد می‌کند */
export function isSendableKind(kind: ItemKind): boolean {
	return kind !== 'unsupported';
}

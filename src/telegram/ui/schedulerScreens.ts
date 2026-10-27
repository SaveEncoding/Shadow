/**
 * متن و کیبورد فیچر «کپی و زمان‌بندی پست».
 *
 * فقط نمایش: هیچ دسترسی‌ای به D1 یا API تلگرام ندارد، بنابراین بدون شبیه‌سازی بات تست می‌شود.
 * همه‌ی تاریخ‌ها به وقت تهران و شمسی نمایش داده می‌شوند.
 */

import { InlineKeyboard } from 'grammy';
import { escapeHtml } from '../services/telegramService.js';
import type { PostItem, QueuePost, SourceRule } from '../../core/schedule/types.js';
import {
	DELAY_PRESETS,
	formatDelay,
	formatRemaining,
	formatTehran,
	previewSnippet,
	toPersianDigits,
} from '../../core/schedule/timing.js';

const KIND_LABELS: Record<string, string> = {
	text: '📝 متن',
	photo: '🖼 عکس',
	video: '🎬 ویدیو',
	document: '📄 فایل',
	audio: '🎵 صدا',
	voice: '🎤 ویس',
	animation: '🎞 گیف',
	sticker: '🏷 استیکر',
	unsupported: '⛔️ ناشناخته',
};

const STATUS_LABELS: Record<string, string> = {
	collecting: '⏳ در حال جمع‌آوری',
	scheduled: '🕒 زمان‌بندی‌شده',
	publishing: '🚀 در حال ارسال',
	published: '✅ منتشر شده',
	failed: '⚠️ ناموفق',
	canceled: '🗑 لغو شده',
};

export function kindLabel(kind: string): string {
	return KIND_LABELS[kind] ?? '📦 محتوا';
}

export function statusLabel(status: string): string {
	return STATUS_LABELS[status] ?? status;
}

/** خلاصه‌ی محتوای یک پست در یک خط */
export function describeItems(items: PostItem[]): string {
	if (items.length === 0) return 'بدون محتوا';
	if (items.length === 1) {
		const item = items[0];
		const snippet = previewSnippet(item.text, 40);
		return snippet ? `${kindLabel(item.kind)} — «${escapeHtml(snippet)}»` : kindLabel(item.kind);
	}
	const kinds = new Set(items.map((i) => kindLabel(i.kind)));
	return `🖼 آلبوم ${toPersianDigits(items.length)} آیتمی (${[...kinds].join('، ')})`;
}

// ─────────────────────────── خانه‌ی فیچر ───────────────────────────

export function schedulerHomeText(channels: Array<{ title: string; pending: number }>): string {
	const lines = [
		'📅 <b>کپی و زمان‌بندی پست</b>',
		'',
		'بات پست‌های کانال مبدأ را برمی‌دارد و پس از مدتی که خودت تعیین می‌کنی در کانال مقصد منتشر می‌کند.',
		'',
		'<b>چرا با تأخیر؟</b> تا قبل از انتشار فرصت داشته باشی متن یا کپشن را ویرایش کنی.',
		'',
	];

	if (channels.length === 0) {
		lines.push('هنوز کانالی ثبت نکرده‌ای. اول از «➕ ثبت کانال» کانالت را ثبت کن.');
	} else {
		lines.push('<b>کانال مقصد را انتخاب کن:</b>');
		for (const ch of channels) {
			const badge = ch.pending > 0 ? ` — ${toPersianDigits(ch.pending)} در صف` : '';
			lines.push(`• ${escapeHtml(ch.title)}${badge}`);
		}
	}

	return lines.join('\n');
}

export function schedulerHomeKeyboard(channels: Array<{ id: number; title: string; pending: number }>): InlineKeyboard {
	const kb = new InlineKeyboard();
	for (const ch of channels) {
		const label = ch.pending > 0 ? `📅 ${ch.title} (${toPersianDigits(ch.pending)})` : `📅 ${ch.title}`;
		kb.text(label.slice(0, 60), `ps:c:${ch.id}`).row();
	}
	kb.text('ℹ️ راهنما', 'ps:help').row().text('🏠 منوی اصلی', 'm:h');
	return kb;
}

// ─────────────────────────── صفحه‌ی یک کانال مقصد ───────────────────────────

export interface ChannelScheduleModel {
	channelId: number;
	title: string;
	rules: SourceRule[];
	pending: number;
	lastPublishedAt: number | null;
	now: number;
}

/** نام نمایشی منبع: عنوان، وگرنه @یوزرنیم، وگرنه شناسه */
export function sourceName(rule: { sourceTitle: string | null; sourceUsername: string | null; sourceChannelId: number }): string {
	if (rule.sourceTitle) return rule.sourceTitle;
	if (rule.sourceUsername) return `@${rule.sourceUsername}`;
	return toPersianDigits(rule.sourceChannelId);
}

export function channelScheduleText(model: ChannelScheduleModel): string {
	const lines = [`📅 <b>${escapeHtml(model.title)}</b>`, ''];

	if (model.rules.length === 0) {
		lines.push(
			'هنوز منبعی وصل نشده است.',
			'',
			'<b>منبع</b> یعنی کانالی که بات پست‌هایش را برمی‌دارد. برای فعال‌کردن:',
			'۱. بات را در کانال مبدأ <b>ادمین</b> کن.',
			'۲. روی «➕ افزودن منبع» بزن و یک پست از آن کانال را به همین چت <b>فوروارد</b> کن.',
		);
	} else {
		lines.push('<b>منابع فعال:</b>');
		for (const rule of model.rules) {
			const state = rule.enabled ? '🟢' : '⏸';
			lines.push(`${state} ${escapeHtml(sourceName(rule))} — تأخیر ${formatDelay(rule.delayMinutes)}`);
		}
	}

	lines.push(
		'',
		`🕒 در صف: <b>${toPersianDigits(model.pending)}</b> پست`,
		model.lastPublishedAt
			? `✅ آخرین انتشار: ${formatTehran(model.lastPublishedAt)}`
			: '✅ هنوز چیزی منتشر نشده است.',
	);

	return lines.join('\n');
}

export function channelScheduleKeyboard(model: ChannelScheduleModel): InlineKeyboard {
	const kb = new InlineKeyboard();

	model.rules.forEach((rule, index) => {
		kb.text(`⏱ تأخیر #${toPersianDigits(index + 1)}`, `ps:dp:r${rule.sourceChannelId}`)
			.text(rule.enabled ? '⏸ خاموش' : '▶️ روشن', `ps:tog:${rule.sourceChannelId}`)
			.text('🗑 حذف', `ps:rdel:${rule.sourceChannelId}`)
			.row();
	});

	kb.text('➕ افزودن منبع', `ps:src:${model.channelId}`)
		.text('📥 کپی دستی', `ps:man:${model.channelId}`)
		.row()
		.text(`📋 صف (${toPersianDigits(model.pending)})`, `ps:q:${model.channelId}`)
		.row()
		.text('🔙 کانال‌ها', 'ps:h')
		.text('🏠 منو', 'm:h');
	return kb;
}

// ─────────────────────────── افزودن منبع ───────────────────────────

export function addSourceText(targetTitle: string): string {
	return [
		`➕ <b>افزودن منبع برای ${escapeHtml(targetTitle)}</b>`,
		'',
		'<b>مرحله ۱:</b> بات را در کانال مبدأ <b>ادمین</b> کن (دسترسی خواندن پست‌ها کافی است).',
		'',
		'<b>مرحله ۲:</b> یک پست از همان کانال را به همین چت <b>فوروارد</b> کن.',
		'',
		'<i>بات از همان فوروارد می‌فهمد کانال مبدأ کدام است و بررسی می‌کند که ادمینش باشد.</i>',
	].join('\n');
}

export function addSourceKeyboard(channelId: number): InlineKeyboard {
	const kb = new InlineKeyboard();
	// سه گزینه‌ی ساده برای تأخیر پیش‌فرض؛ بعداً از صفحه‌ی منبع قابل تغییر است
	for (const minutes of [15, 30, 60]) {
		kb.text(`⏱ ${formatDelay(minutes)}`, `ps:sd:${channelId}:${minutes}`);
	}
	kb.row().text('🔙 بازگشت', `ps:c:${channelId}`);
	return kb;
}

export function addSourceDelayText(targetTitle: string, minutes: number): string {
	return [
		`⏱ <b>تأخیر پیش‌فرض</b> — ${escapeHtml(targetTitle)}`,
		'',
		`پست‌های جدید پس از <b>${formatDelay(minutes)}</b> منتشر می‌شوند.`,
		'',
		'در این فاصله می‌توانی متن را ویرایش کنی، زمان را جابه‌جا کنی یا پست را لغو کنی.',
	].join('\n');
}

export function manualCaptureText(targetTitle: string, delayMinutes: number): string {
	return [
		`📥 <b>کپی دستی</b> — ${escapeHtml(targetTitle)}`,
		'',
		'یک پست از هر کانالی را به همین چت <b>فوروارد</b> کن (یا خودت بفرست).',
		'',
		`پس از ${formatDelay(delayMinutes)} در کانال مقصد منتشر می‌شود.`,
		'',
		'<i>محدودیت: عکس، ویدیو، فایل، صدا، ویس، گیف، استیکر و متن. نظرسنجی و موقعیت مکانی پشتیبانی نمی‌شوند.</i>',
	].join('\n');
}

export function manualCaptureKeyboard(channelId: number): InlineKeyboard {
	return new InlineKeyboard().text('🔙 بازگشت', `ps:c:${channelId}`);
}

// ─────────────────────────── انتخاب تأخیر ───────────────────────────

/**
 * @param scope `r<sourceChannelId>` برای یک قانون، `p<postId>` برای جابه‌جایی یک پست
 */
export function delayPickerText(scopeKind: 'rule' | 'post', currentMinutes: number | null, now: number): string {
	const lines = [
		scopeKind === 'rule' ? '⏱ <b>تأخیر انتشار</b>' : '⏰ <b>زمان انتشار را تغییر بده</b>',
		'',
	];
	if (scopeKind === 'rule') {
		lines.push(
			'هر پست جدید مبدأ، این مدت بعد منتشر می‌شود.',
			'',
			currentMinutes !== null ? `مقدار فعلی: <b>${formatDelay(currentMinutes)}</b>` : '',
			'',
			'<i>اگر می‌خواهی رأس ساعت مشخصی منتشر شود، بعد از رسیدن پست از «⏰ تغییر زمان» استفاده کن.</i>',
		);
	} else {
		lines.push('زمان جدید را انتخاب کن:');
	}
	return lines.filter(Boolean).join('\n');
}

export function delayPickerKeyboard(scope: string, scopeKind: 'rule' | 'post'): InlineKeyboard {
	const kb = new InlineKeyboard();
	DELAY_PRESETS.forEach((preset, index) => {
		kb.text(preset.label, `ps:ds:${scope}:${preset.minutes}`);
		if (index % 2 === 1) kb.row();
	});
	if (DELAY_PRESETS.length % 2 === 1) kb.row();
	kb.text('🔙 بازگشت', scopeKind === 'rule' ? 'ps:h' : `ps:p:${scope.slice(1)}`);
	return kb;
}

// ─────────────────────────── صف و جزئیات پست ───────────────────────────

export function queueText(posts: QueuePost[], channelTitle: string, now: number): string {
	const lines = [`📋 <b>صف انتشار</b> — ${escapeHtml(channelTitle)}`, ''];

	if (posts.length === 0) {
		lines.push('صف خالی است. هر پست تازه‌ای که از منبع برسد اینجا نمایش داده می‌شود.');
		return lines.join('\n');
	}

	posts.forEach((post, index) => {
		const when = post.status === 'scheduled' ? formatTehran(post.publishAt) : statusLabel(post.status);
		const remaining = post.status === 'scheduled' ? ` (${formatRemaining(post.publishAt, now)})` : '';
		lines.push(`${toPersianDigits(index + 1)}. ${describeItems(post.items)}`);
		lines.push(`   ${when}${remaining}`);
	});

	return lines.join('\n');
}

export function queueKeyboard(posts: QueuePost[], channelId: number): InlineKeyboard {
	const kb = new InlineKeyboard();
	for (const post of posts) {
		const snippet = previewSnippet(post.items.map((i) => i.text ?? '').join(' '), 24) || kindLabel(post.items[0]?.kind ?? 'text');
		kb.text(`🔎 ${snippet}`.slice(0, 58), `ps:p:${post.id}`).row();
	}
	kb.text('🔙 بازگشت', `ps:c:${channelId}`);
	return kb;
}

export function postDetailText(post: QueuePost, channelTitle: string, now: number): string {
	const lines = [
		'🔎 <b>جزئیات پست</b>',
		'',
		`${statusLabel(post.status)} — مقصد: <b>${escapeHtml(channelTitle)}</b>`,
	];

	if (post.status === 'scheduled' || post.status === 'collecting') {
		lines.push(`⏰ ${formatTehran(post.publishAt)}`);
		lines.push(`⏳ ${formatRemaining(post.publishAt, now)}`);
	}
	if (post.status === 'published' && post.publishedAt) {
		lines.push(`✅ منتشر شده در ${formatTehran(post.publishedAt)}`);
	}
	if (post.status === 'failed' && post.lastError) {
		lines.push(`⚠️ خطا: <code>${escapeHtml(post.lastError.slice(0, 200))}</code>`);
	}

	if (post.sourceChannelId) {
		lines.push(`👤 منبع: ${escapeHtml(post.sourceTitle ?? (post.sourceUsername ? `@${post.sourceUsername}` : 'کانال مبدأ'))}`);
	} else {
		lines.push('👤 منبع: کپی دستی');
	}

	lines.push('', `<b>محتوا</b> (${describeItems(post.items)})`);

	const primary = post.items.find((item) => (item.text ?? '').trim().length > 0);
	if (primary?.text) {
		const text = primary.text.length > 900 ? `${primary.text.slice(0, 900)}…` : primary.text;
		// متن کاربر ممکن است HTML داشته باشد؛ با <code> امن نمایش داده می‌شود.
		lines.push('', `<code>${escapeHtml(text)}</code>`);
	} else {
		lines.push('', '<i>این پست متن یا کپشن ندارد.</i>');
	}

	if (post.edited) lines.push('', '✏️ <i>این پست توسط ادمین ویرایش شده است.</i>');

	return lines.join('\n');
}

export function postDetailKeyboard(post: QueuePost, now: number): InlineKeyboard {
	const kb = new InlineKeyboard();
	const active = post.status === 'scheduled' || post.status === 'collecting' || post.status === 'failed';

	if (active) {
		kb.text('✅ انتشار الان', `ps:pub:${post.id}`).row();
		const hasText = post.items.some((item) => (item.text ?? '').length > 0 || item.kind === 'text');
		if (hasText) {
			kb.text('✏️ ویرایش متن', `ps:txt:${post.id}`).row();
		}
		kb.text('⏰ تغییر زمان', `ps:dp:p${post.id}`).text('🗑 انصراف', `ps:del:${post.id}`).row();
	}

	kb.text('👁 پیش‌نمایش اصل پست', `ps:view:${post.id}`).row();
	kb.text('🔙 صف', `ps:q:${post.targetChannelId}`).text('🏠 منو', 'm:h');
	return kb;
}

export function awaitingEditText(field: 'text' | 'caption', currentText: string | null): string {
	const what = field === 'text' ? 'متن جدید پست' : 'کپشن جدید';
	const lines = [`✏️ <b>${what}</b> را بفرست.`, '', 'می‌توانی از بولد، ایتالیک، لینک و اسپویلر استفاده کنی؛ قالب‌بندی حفظ می‌شود.'];
	if (currentText) {
		lines.push('', 'متن فعلی:', `<code>${escapeHtml(currentText.slice(0, 600))}</code>`);
	}
	lines.push('', '<i>برای انصراف دستور /cancel را بفرست.</i>');
	return lines.join('\n');
}

export function awaitingEditKeyboard(postId: number): InlineKeyboard {
	return new InlineKeyboard().text('✖️ انصراف', `ps:txtcancel:${postId}`);
}

// ─────────────────────────── اعلان‌ها ───────────────────────────

export function queuedNotificationText(post: QueuePost, channelTitle: string, now: number): string {
	const lines = [
		'📥 <b>پست تازه در صف</b>',
		'',
		describeItems(post.items),
		'',
		`مقصد: <b>${escapeHtml(channelTitle)}</b>`,
		`⏰ انتشار: ${formatTehran(post.publishAt)}`,
		`⏳ ${formatRemaining(post.publishAt, now)}`,
		'',
		'تا قبل از انتشار می‌توانی ویرایش کنی، زمان را عوض کنی یا لغو کنی.',
	];
	return lines.join('\n');
}

export function publishedNotificationText(post: QueuePost, channelTitle: string, link: string | null): string {
	const lines = ['✅ <b>منتشر شد</b>', '', describeItems(post.items), '', `مقصد: <b>${escapeHtml(channelTitle)}</b>`];
	if (post.publishedAt) lines.push(`🕒 ${formatTehran(post.publishedAt)}`);
	if (link) lines.push('', `🔗 ${link}`);
	return lines.join('\n');
}

export function failedNotificationText(post: QueuePost, channelTitle: string): string {
	return [
		'⚠️ <b>انتشار ناموفق بود</b>',
		'',
		describeItems(post.items),
		`مقصد: <b>${escapeHtml(channelTitle)}</b>`,
		post.lastError ? `خطا: <code>${escapeHtml(post.lastError.slice(0, 200))}</code>` : '',
		'',
		'<i>مطمئن شو بات در کانال مقصد ادمین است و اجازه‌ی ارسال دارد.</i>',
	]
		.filter(Boolean)
		.join('\n');
}

export function cancellingKeyboard(): InlineKeyboard {
	return new InlineKeyboard().text('🏠 منو', 'm:h');
}

export function helpText(): string {
	return [
		'ℹ️ <b>راهنمای زمان‌بندی پست</b>',
		'',
		'<b>۱. کانال مقصد</b> — کانالی که پست‌ها باید در آن منتشر شوند. باید قبلاً ثبت شده و تو ادمینش باشی.',
		'',
		'<b>۲. منبع</b> — کانالی که پست‌هایش کپی می‌شوند. بات باید در آن ادمین باشد تا پست‌ها را ببیند.',
		'',
		'<b>۳. تأخیر</b> — فاصله‌ی بین رسیدن پست و انتشار آن. این پنجره برای ویرایش توست.',
		'',
		'<b>۴. ویرایش</b> — روی پست در صف بزن و «✏️ ویرایش متن» را انتخاب کن. تغییر روی همان پستی که در کانال می‌رود اعمال می‌شود.',
		'',
		'<b>۵. کپی دستی</b> — اگر بات نمی‌تواند در کانال مبدأ ادمین شود، پست را خودت برای بات فوروارد کن.',
		'',
		'<b>نکته:</b> برای انتشار دقیقاً رأس یک ساعت مشخص، بعد از رسیدن پست «⏰ تغییر زمان» را بزن.',
		'',
		'<i>محتوا با file_id تلگرام دوباره ارسال می‌شود؛ بنابراین حذف پست از کانال مبدأ، صف را خراب نمی‌کند.</i>',
	].join('\n');
}

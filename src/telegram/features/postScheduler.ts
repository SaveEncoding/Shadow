/**
 * فیچر «کپی و زمان‌بندی پست».
 *
 * جریان کاری:
 *   کانال مبدأ (بات ادمین) ──پست جدید──▶ صف ──تأخیر (پنجره‌ی ویرایش)──▶ کانال مقصد
 *
 * چرا تأخیر؟ چون Bot API تلگرام «پیام زمان‌بندی‌شده» ندارد؛ پس خودمان پست را
 * نگه می‌داریم و در زمان مقرر می‌فرستیم. در این فاصله ادمین می‌تواند متن/کپشن
 * را ویرایش کند، زمان را جابه‌جا کند یا پست را لغو کند.
 *
 * الگوی callback_data (سقف تلگرام ۶۴ بایت است؛ همه‌ی این‌ها زیر ۳۰ بایت‌اند):
 *   ps:h                        خانه
 *   ps:c:<channelId>            صفحه‌ی کانال مقصد
 *   ps:src:<channelId>          افزودن منبع (منتظر فوروارد)
 *   ps:man:<channelId>          کپی دستی (منتظر فوروارد)
 *   ps:pubsrc:<channelId>       افزودن کانال عمومی (منتظر @یوزرنیم)
 *   ps:usepub:<channelId>:<user>  پیشنهاد حالت عمومی وقتی بات ادمین نیست
 *   ps:sd:<channelId>:<min>     تأخیر پیش‌فرض برای همان منبع
 *   ps:dp:<scope>               انتخاب تأخیر/زمان  (scope = r<sourceId> یا p<postId>)
 *   ps:ds:<scope>:<min>         اعمال مقدار
 *   ps:tog:<sourceId>           روشن/خاموش کردن قانون
 *   ps:rdel:<sourceId>          حذف قانون
 *   ps:q:<channelId>            صف
 *   ps:p:<postId>               جزئیات پست
 *   ps:pub:<postId>             انتشار فوری
 *   ps:txt:<postId>             ویرایش متن/کپشن
 *   ps:txtcancel:<postId>       انصراف از ویرایش
 *   ps:del:<postId>             لغو پست
 *   ps:view:<postId>            پیش‌نمایش اصل پست در چت
 *   ps:help                     راهنما
 */

import { InlineKeyboard, type Context } from 'grammy';
import { captureSourcePost, applySourceEdit, extractPostItem, queueManualPost, unsupportedReason } from '../capturePost.js';
import { computePublishAt, DEFAULT_DELAY_MINUTES, formatDelay, SECONDS_PER_MINUTE } from '../../core/schedule/timing.js';
import {
	latestMessageId,
	isValidChannelUsername,
	normalizeUsername,
	publicSourceChannelId,
} from '../../core/schedule/publicFeed.js';
import { fetchPublicFeed } from '../publicFeed.js';
import type { PostItem } from '../../core/schedule/types.js';
import { getChannelByTelegramId, getChannels, isUserChannelAdmin } from '../db/channels.js';
import {
	clearCaptureSession,
	clearEditSession,
	countPendingPosts,
	cancelPost,
	deleteSourceRule,
	findCaptureSession,
	findEditSession,
	getLastPublished,
	getPost,
	getSourceRule,
	listPendingPosts,
	listRulesForTarget,
	recordPollResult,
	reschedulePost,
	saveSourceRule,
	setRuleDelay,
	setRuleEnabled,
	startCaptureSession,
	startEditSession,
	updateItemContent,
} from '../db/postQueue.js';
import { notifyQueued, publishOne, type SchedulerApi } from '../publishQueue.js';
import { feedPostLink } from '../pollSources.js';
import { renderScreen, toast, toastAlert } from '../ui/render.js';
import {
	addSourceText,
	addSourceKeyboard,
	awaitingEditKeyboard,
	awaitingEditText,
	channelScheduleKeyboard,
	channelScheduleText,
	delayPickerKeyboard,
	delayPickerText,
	helpText,
	manualCaptureKeyboard,
	manualCaptureText,
	postDetailKeyboard,
	postDetailText,
	publicSourceAddedText,
	publicSourceKeyboard,
	publicSourceText,
	queueKeyboard,
	queueText,
	schedulerHomeKeyboard,
	schedulerHomeText,
} from '../ui/schedulerScreens.js';
import { getForwardedChannel } from './channels.js';

/** عمر جلسه‌های «منتظر فوروارد» و «منتظر متن» */
const SESSION_TTL_SECONDS = 15 * SECONDS_PER_MINUTE;

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * کلاینت تلگرام همان درخواست جاری.
 * عمداً `new Api(token)` نمی‌سازیم: کلاینت تازه، تنظیمات/میان‌افزارهای بات
 * (و در تست، شبکه‌ی قلابی) را دور می‌زند و درخواست واقعی می‌فرستد.
 */
function schedulerApi(ctx: Context): SchedulerApi {
	return ctx.api as unknown as SchedulerApi;
}

/** آیا کاربر ادمین این کانال مقصد است؟ */
async function canManage(db: D1Database, channelId: number, userId: number | undefined): Promise<boolean> {
	if (!userId) return false;
	return isUserChannelAdmin(db, channelId, userId);
}

/**
 * ثبت فیچر روی بات.
 * باید **قبل** از `channelSuffixFeature` در `main-tel.ts` ثبت شود، چون آن فیچر
 * برای `channel_post` زنجیره‌ی middleware را متوقف می‌کند.
 */
export function postSchedulerFeature(bot: any, env: { my_database: D1Database; TELEGRAM_TOKEN?: string }): void {
	const db = env.my_database;

	const openHub = async (ctx: Context) => {
		const userId = ctx.from?.id;
		if (!userId) return;

		const rows = await getChannels(db, userId);
		const channels = [];
		for (const row of rows) {
			channels.push({
				id: Number(row.channel_id),
				title: row.title,
				pending: await countPendingPosts(db, Number(row.channel_id)),
			});
		}

		await renderScreen(
			ctx,
			schedulerHomeText(channels.map((c) => ({ title: c.title, pending: c.pending }))),
			schedulerHomeKeyboard(channels),
		);
	};

	bot.command('schedule', openHub);
	bot.command('post', openHub);
	bot.callbackQuery('ps:h', openHub);
	bot.callbackQuery('ps:help', async (ctx: Context) => {
		await renderScreen(ctx, helpText(), undefined);
	});

	/** صفحه‌ی یک کانال مقصد */
	const openChannel = async (ctx: Context, channelId: number) => {
		if (!(await canManage(db, channelId, ctx.from?.id))) {
			return toast(ctx, 'دسترسی به این کانال ندارید.');
		}
		const channel = await getChannelByTelegramId(db, channelId);
		if (!channel) return toast(ctx, 'کانال پیدا نشد.');

		const now = nowSeconds();
		const [rules, pending, last] = await Promise.all([
			listRulesForTarget(db, channelId),
			countPendingPosts(db, channelId),
			getLastPublished(db, channelId),
		]);

		const model = {
			channelId,
			title: channel.title,
			rules,
			pending,
			lastPublishedAt: last?.publishedAt ?? null,
			now,
		};

		return renderScreen(ctx, channelScheduleText(model), channelScheduleKeyboard(model));
	};

	bot.callbackQuery(/^ps:c:(-?\d+)$/, async (ctx: Context) => {
		await openChannel(ctx, Number(ctx.match[1]));
	});

	// ── افزودن منبع ──
	bot.callbackQuery(/^ps:src:(-?\d+)$/, async (ctx: Context) => {
		const channelId = Number(ctx.match[1]);
		if (!(await canManage(db, channelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		const channel = await getChannelByTelegramId(db, channelId);
		if (!channel) return toast(ctx, 'کانال پیدا نشد.');

		const now = nowSeconds();
		await startCaptureSession(db, {
			userId: ctx.from.id,
			targetChannelId: channelId,
			mode: 'source',
			delayMinutes: DEFAULT_DELAY_MINUTES,
			expiresAt: now + SESSION_TTL_SECONDS,
		});

		return renderScreen(ctx, addSourceText(channel.title), addSourceKeyboard(channelId));
	});

	/** انتخاب تأخیر پیش‌فرض قبل از فوروارد کردن پست */
	bot.callbackQuery(/^ps:sd:(-?\d+):(\d+)$/, async (ctx: Context) => {
		const channelId = Number(ctx.match[1]);
		const minutes = Number(ctx.match[2]);
		if (!(await canManage(db, channelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		const channel = await getChannelByTelegramId(db, channelId);
		const now = nowSeconds();
		await startCaptureSession(db, {
			userId: ctx.from.id,
			targetChannelId: channelId,
			mode: 'source',
			delayMinutes: minutes,
			expiresAt: now + SESSION_TTL_SECONDS,
		});

		return toast(ctx, `تأخیر ${formatDelay(minutes)} ثبت شد؛ حالا یک پست از کانال مبدأ فوروارد کن.`);
	});

	// ── کپی دستی ──
	bot.callbackQuery(/^ps:man:(-?\d+)$/, async (ctx: Context) => {
		const channelId = Number(ctx.match[1]);
		if (!(await canManage(db, channelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		const channel = await getChannelByTelegramId(db, channelId);
		const now = nowSeconds();
		const rules = await listRulesForTarget(db, channelId);
		const delay = rules[0]?.delayMinutes ?? DEFAULT_DELAY_MINUTES;

		await startCaptureSession(db, {
			userId: ctx.from.id,
			targetChannelId: channelId,
			mode: 'manual',
			delayMinutes: delay,
			expiresAt: now + SESSION_TTL_SECONDS,
		});

		return renderScreen(
			ctx,
			manualCaptureText(channel?.title ?? String(channelId), delay),
			manualCaptureKeyboard(channelId),
		);
	});

	// ── کانال عمومی (بدون عضویت بات) ──
	bot.callbackQuery(/^ps:pubsrc:(-?\d+)$/, async (ctx: Context) => {
		const channelId = Number(ctx.match[1]);
		if (!(await canManage(db, channelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		const channel = await getChannelByTelegramId(db, channelId);
		if (!channel) return toast(ctx, 'کانال پیدا نشد.');

		await startCaptureSession(db, {
			userId: ctx.from.id,
			targetChannelId: channelId,
			mode: 'public',
			delayMinutes: DEFAULT_DELAY_MINUTES,
			expiresAt: nowSeconds() + SESSION_TTL_SECONDS,
		});

		return renderScreen(ctx, publicSourceText(channel.title), publicSourceKeyboard(channelId));
	});

	/**
	 * ثبت یک منبع عمومی. مشترک بین «افزودن با یوزرنیم» و «پیشنهاد حالت عمومی».
	 * خروجی: پیام نتیجه برای فرستادن به کاربر.
	 */
	const registerPublicSource = async (
		userId: number,
		channelId: number,
		chatId: number,
		rawUsername: string,
		delayMinutes: number,
	): Promise<{ ok: true } | { ok: false; message: string }> => {
		if (!isValidChannelUsername(rawUsername)) {
			return { ok: false, message: '❌ آدرس کانال درست نیست. نمونه‌ی درست: <code>@my_channel</code>' };
		}
		const username = normalizeUsername(rawUsername);

		const existing = await listRulesForTarget(db, channelId);
		if (existing.some((rule) => rule.pollUsername === username || rule.sourceUsername === username)) {
			return { ok: false, message: 'این کانال از قبل به این مقصد وصل شده است.' };
		}

		// پیش از ثبت، یک بار واقعاً می‌خوانیم تا مطمئن شویم پیش‌نمایش عمومی دارد
		const feed = await fetchPublicFeed(username);
		if (feed.ok === false) return { ok: false, message: `❌ ${feed.error}` };

		const now = nowSeconds();
		const ruleId = await saveSourceRule(db, {
			sourceChannelId: publicSourceChannelId(username),
			sourceTitle: `@${username}`,
			sourceUsername: username,
			targetChannelId: channelId,
			delayMinutes,
			addedBy: userId,
			notifyChatId: chatId,
			pollUsername: username,
			now,
		});

		// کِرسر روی آخرین پست فعلی: آرشیو کانال یک‌جا سرازیر نمی‌شود
		if (ruleId) {
			await recordPollResult(db, { ruleId, now, cursorMessageId: latestMessageId(feed.posts) });
		}

		return { ok: true };
	};

	// پیشنهاد حالت عمومی، وقتی بات در کانال مبدأ ادمین نیست
	bot.callbackQuery(/^ps:usepub:(-?\d+):(@?[A-Za-z0-9_]+)$/, async (ctx: Context) => {
		const channelId = Number(ctx.match[1]);
		const username = ctx.match[2];
		if (!(await canManage(db, channelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		const channel = await getChannelByTelegramId(db, channelId);
		const result = await registerPublicSource(
			ctx.from!.id,
			channelId,
			ctx.chat?.id ?? ctx.from!.id,
			username,
			DEFAULT_DELAY_MINUTES,
		);

		if (result.ok === false) {
			await toast(ctx, 'انجام نشد.');
			return ctx.reply(result.message);
		}
		await toast(ctx, 'اضافه شد.');

		await ctx.reply(
			publicSourceAddedText(`@${normalizeUsername(username)}`, channel?.title ?? String(channelId), DEFAULT_DELAY_MINUTES),
		);
		return openChannel(ctx, channelId);
	});

	// ── انتخاب تأخیر / زمان ──
	bot.callbackQuery(/^ps:dp:([rp]-?\d+)$/, async (ctx: Context) => {
		const scope = ctx.match[1];
		const isRule = scope.startsWith('r');

		if (isRule) {
			const rule = await getSourceRule(db, Number(scope.slice(1)));
			if (!rule) return toast(ctx, 'این منبع پیدا نشد.');
			if (!(await canManage(db, rule.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');
			return renderScreen(
				ctx,
				delayPickerText('rule', rule.delayMinutes, nowSeconds()),
				delayPickerKeyboard(scope, 'rule'),
			);
		}

		const post = await getPost(db, Number(scope.slice(1)));
		if (!post) return toast(ctx, 'پست پیدا نشد.');
		if (!(await canManage(db, post.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');
		return renderScreen(ctx, delayPickerText('post', null, nowSeconds()), delayPickerKeyboard(scope, 'post'));
	});

	bot.callbackQuery(/^ps:ds:([rp]-?\d+):(\d+)$/, async (ctx: Context) => {
		const scope = ctx.match[1];
		const minutes = Number(ctx.match[2]);
		const now = nowSeconds();

		if (scope.startsWith('r')) {
			const sourceId = Number(scope.slice(1));
			const rule = await getSourceRule(db, sourceId);
			if (!rule) return toast(ctx, 'این منبع پیدا نشد.');
			if (!(await canManage(db, rule.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

			await setRuleDelay(db, sourceId, minutes, now);
			await toast(ctx, `تأخیر روی ${formatDelay(minutes)} تنظیم شد.`);
			return openChannel(ctx, rule.targetChannelId);
		}

		const post = await getPost(db, Number(scope.slice(1)));
		if (!post) return toast(ctx, 'پست پیدا نشد.');
		if (!(await canManage(db, post.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		await reschedulePost(db, post.id, computePublishAt(now, minutes), now);
		await toast(ctx, `برای ${formatDelay(minutes)} دیگر زمان‌بندی شد.`);
		return openPost(ctx, post.id);
	});

	// ── مدیریت قانون‌ها ──
	bot.callbackQuery(/^ps:tog:(-?\d+)$/, async (ctx: Context) => {
		const sourceId = Number(ctx.match[1]);
		const rule = await getSourceRule(db, sourceId);
		if (!rule) return toast(ctx, 'این منبع پیدا نشد.');
		if (!(await canManage(db, rule.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		await setRuleEnabled(db, sourceId, !rule.enabled, nowSeconds());
		await toast(ctx, rule.enabled ? 'منبع خاموش شد.' : 'منبع روشن شد.');
		return openChannel(ctx, rule.targetChannelId);
	});

	bot.callbackQuery(/^ps:rdel:(-?\d+)$/, async (ctx: Context) => {
		const sourceId = Number(ctx.match[1]);
		const rule = await getSourceRule(db, sourceId);
		if (!rule) return toast(ctx, 'این منبع پیدا نشد.');
		if (!(await canManage(db, rule.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		await deleteSourceRule(db, sourceId);
		await toast(ctx, 'منبع حذف شد.');
		return openChannel(ctx, rule.targetChannelId);
	});

	// ── صف ──
	const openQueue = async (ctx: Context, channelId: number) => {
		const channel = channelId ? await getChannelByTelegramId(db, channelId) : null;
		if (!channel) return openHub(ctx);
		if (!(await canManage(db, channelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		const now = nowSeconds();
		const posts = await listPendingPosts(db, channelId, 10);
		return renderScreen(
			ctx,
			queueText(posts, channel.title, now),
			queueKeyboard(posts, channelId),
		);
	};

	bot.callbackQuery(/^ps:q:(-?\d+)$/, async (ctx: Context) => {
		await openQueue(ctx, Number(ctx.match[1]));
	});

	/** صفحه‌ی جزئیات یک پست */
	const openPost = async (ctx: Context, postId: number) => {
		const post = await getPost(db, postId);
		if (!post) return toast(ctx, 'پست پیدا نشد.');
		if (!(await canManage(db, post.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		const channel = await getChannelByTelegramId(db, post.targetChannelId);
		const now = nowSeconds();
		return renderScreen(
			ctx,
			postDetailText(post, channel?.title ?? String(post.targetChannelId), now),
			postDetailKeyboard(post, now),
		);
	};

	bot.callbackQuery(/^ps:p:(\d+)$/, async (ctx: Context) => {
		await openPost(ctx, Number(ctx.match[1]));
	});

	// ── انتشار فوری ──
	bot.callbackQuery(/^ps:pub:(\d+)$/, async (ctx: Context) => {
		const postId = Number(ctx.match[1]);
		const post = await getPost(db, postId);
		if (!post) return toast(ctx, 'پست پیدا نشد.');
		if (!(await canManage(db, post.targetChannelId, ctx.from?.id))) return toastAlert(ctx, 'دسترسی ندارید.');

		// همان مسیر کرون؛ پس هیچ مسیر دومی برای «ارسال به کانال» وجود ندارد
		const result = await publishOne(schedulerApi(ctx), db, postId, nowSeconds());

		if (result.status === 'published') {
			await toast(ctx, '✅ منتشر شد.');
			return openQueue(ctx, post.targetChannelId);
		}
		if (result.status === 'failed') {
			return toastAlert(ctx, 'انتشار ناموفق بود؛ جزئیات در صفحه‌ی پست است.');
		}
		return toast(ctx, 'این پست هم‌اکنون در حال ارسال است.');
	});

	// ── ویرایش متن/کپشن ──
	bot.callbackQuery(/^ps:txt:(\d+)$/, async (ctx: Context) => {
		const postId = Number(ctx.match[1]);
		const post = await getPost(db, postId);
		if (!post) return toast(ctx, 'پست پیدا نشد.');
		if (!(await canManage(db, post.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		const item = post.items.find((i) => (i.text ?? '').length > 0) ?? post.items[0];
		if (!item) return toast(ctx, 'این پست محتوایی برای ویرایش ندارد.');

		const field = item.kind === 'text' ? 'text' : 'caption';
		const now = nowSeconds();

		await startEditSession(db, {
			postId,
			userId: ctx.from.id,
			chatId: ctx.chat?.id ?? post.previewChatId ?? post.createdBy,
			messageId: ctx.callbackQuery?.message?.message_id ?? 0,
			field,
			targetMessageId: item.sourceMessageId,
			expiresAt: now + SESSION_TTL_SECONDS,
		});

		return renderScreen(ctx, awaitingEditText(field, item.text), awaitingEditKeyboard(postId));
	});

	bot.callbackQuery(/^ps:txtcancel:(\d+)$/, async (ctx: Context) => {
		await clearEditSession(db, ctx.from!.id);
		await openPost(ctx, Number(ctx.match[1]));
	});

	// ── لغو پست ──
	bot.callbackQuery(/^ps:del:(\d+)$/, async (ctx: Context) => {
		const postId = Number(ctx.match[1]);
		const post = await getPost(db, postId);
		if (!post) return toast(ctx, 'پست پیدا نشد.');
		if (!(await canManage(db, post.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');

		await cancelPost(db, postId, nowSeconds());
		await toast(ctx, 'پست لغو شد.');
		return openQueue(ctx, post.targetChannelId);
	});

	// ── پیش‌نمایش اصل پست (کپی در چت ادمین) ──
	bot.callbackQuery(/^ps:view:(\d+)$/, async (ctx: Context) => {
		const post = await getPost(db, Number(ctx.match[1]));
		if (!post) return toast(ctx, 'پست پیدا نشد.');
		if (!(await canManage(db, post.targetChannelId, ctx.from?.id))) return toast(ctx, 'دسترسی ندارید.');
		if (!post.sourceChannelId) return toast(ctx, 'این پست دستی است و نسخه‌ی اصلی در کانال ندارد.');

		const chatId = ctx.chat?.id;
		if (!chatId) return toast(ctx, 'چت پیدا نشد.');

		// منبع عمومی (بدون عضویت): بات نمی‌تواند کپی کند، پس لینک خود پست را می‌فرستیم
		if (post.sourceChannelId < -1_000_000 && post.sourceUsername) {
			const item = post.items[0];
			if (!item) return toast(ctx, 'این پست محتوایی ندارد.');
			await ctx.reply(feedPostLink(post.sourceUsername, item.sourceMessageId), {
				link_preview_options: { is_disabled: false },
			});
			return toast(ctx, 'پیش‌نمایش ارسال شد.');
		}

		try {
			await ctx.api.copyMessage(chatId, post.sourceChannelId, post.items[0].sourceMessageId);
			await toast(ctx, 'پیش‌نمایش ارسال شد.');
		} catch {
			await toastAlert(ctx, 'نسخه‌ی اصلی در کانال مبدأ پیدا نشد (شاید حذف شده باشد).');
		}
	});

	// ── دریافت متن ویرایش‌شده ──
	// بعد از handler مربوط به pendingInput در menu ثبت می‌شود، پس فقط وقتی
	// menu آن را مصرف نکند به اینجا می‌رسیم.
	bot.on('message:text', async (ctx: Context, next: () => Promise<void>) => {
		const userId = ctx.from?.id;
		if (!userId || ctx.chat?.type !== 'private') return next();

		const session = await findEditSession(db, userId, nowSeconds());
		if (!session) return next();

		const text = ctx.message?.text ?? '';
		if (text.startsWith('/cancel')) {
			await clearEditSession(db, userId);
			await openPost(ctx, session.postId);
			return;
		}
		if (text.startsWith('/')) {
			await clearEditSession(db, userId);
			return next();
		}

		const post = await getPost(db, session.postId);
		if (!post) {
			await clearEditSession(db, userId);
			return toast(ctx, 'این پست دیگر وجود ندارد.');
		}
		if (!(await canManage(db, post.targetChannelId, userId))) {
			await clearEditSession(db, userId);
			return toast(ctx, 'دسترسی به این کانال را از دست داده‌اید.');
		}

		// قالب‌بندی کاربر (بولد/لینک/اسپویلر) حفظ می‌شود: خودِ entities را ذخیره می‌کنیم
		// و در زمان ارسال با پارامتر entities می‌فرستیم — نه HTML دست‌ساز.
		const entities = ctx.message?.entities ?? null;
		await updateItemContent(db, session.postId, session.targetMessageId, { text, entities }, nowSeconds());
		await clearEditSession(db, userId);

		await ctx.reply('✅ ذخیره شد. پیش‌نمایش به‌روز شد؛ همین متن در کانال منتشر می‌شود.');
		await notifyQueued(schedulerApi(ctx), db, session.postId, nowSeconds());
		return;
	});

	// ── فوروارد برای «افزودن منبع» یا «کپی دستی» ──
	bot.on('message', async (ctx: Context, next: () => Promise<void>) => {
		const userId = ctx.from?.id;
		if (!userId || ctx.chat?.type !== 'private') return next();

		const session = await findCaptureSession(db, userId, nowSeconds());
		if (!session) return next();

		// دستورها جلسه را نمی‌شکنند: `/cancel` جلسه را می‌بندد و بقیه‌ی دستورها
		// به فیچرهای خودشان می‌رسند (وگرنه «/cancel را بزن» در متن بی‌اثر بود).
		const incoming = ctx.message?.text ?? '';
		if (incoming.startsWith('/')) {
			if (incoming === '/cancel' || incoming.startsWith('/cancel ')) {
				await clearCaptureSession(db, userId);
				return ctx.reply('لغو شد. هر وقت خواستی از /schedule دوباره شروع کن.');
			}
			return next();
		}

		if (!(await canManage(db, session.targetChannelId, userId))) {
			await clearCaptureSession(db, userId);
			return ctx.reply('⛔️ دسترسی به کانال مقصد را از دست داده‌اید.');
		}

		const channel = await getChannelByTelegramId(db, session.targetChannelId);
		const targetTitle = channel?.title ?? String(session.targetChannelId);

		// حالت ۰: منبع عمومی — کاربر باید @یوزرنیم بفرستد
		if (session.mode === 'public') {
			const text = (ctx.message?.text ?? '').trim();
			const result = await registerPublicSource(
				userId,
				session.targetChannelId,
				ctx.chat.id,
				text,
				session.delayMinutes,
			);
			if (result.ok === false) {
				// جلسه باز می‌ماند تا کاربر آدرس درست را بفرستد (یا /cancel بزند)
				return ctx.reply(result.message);
			}

			await clearCaptureSession(db, userId);
			await ctx.reply(
				publicSourceAddedText(`@${normalizeUsername(text)}`, targetTitle, session.delayMinutes),
			);
			return openChannel(ctx, session.targetChannelId);
		}

		// حالت ۱: ثبت منبع — از فوروارد می‌فهمیم کانال مبدأ کدام است
		if (session.mode === 'source') {
			const source = getForwardedChannel(ctx.message) as { id: number; title: string; username: string | null } | null;
			if (!source) {
				return ctx.reply(
					'❌ این پیام از یک کانال فوروارد نشده است.\nیک پست از کانال مبدأ را فوروارد کن، یا /cancel را بزن.',
				);
			}

			// شرط سخت: بات باید ادمین کانال مبدأ باشد تا پست‌ها را ببیند
			try {
				const me = ctx.me ?? (await ctx.api.getMe());
				const botMember = await ctx.api.getChatMember(source.id, me.id);
				if (botMember.status !== 'administrator' && botMember.status !== 'creator') {
					// اگر کانال عمومی است، راه دوم را پیشنهاد می‌دهیم (پیش‌نمایش وب)
					if (source.username && isValidChannelUsername(source.username)) {
						const kb = new InlineKeyboard()
							.text('🌐 افزودن بدون عضویت', `ps:usepub:${session.targetChannelId}:${source.username}`)
							.row()
							.text('🔙 بازگشت', `ps:c:${session.targetChannelId}`);
						return ctx.reply(
							`بات در کانال «${source.title}» ادمین نیست.\n\n` +
								'دو راه داری:\n' +
								'۱. بات را در آن کانال ادمین کن (کامل‌ترین حالت: هر نوع محتوایی کپی می‌شود).\n' +
								`۲. همین کانال را «بدون عضویت» وصل کن؛ چون عمومی است (@${source.username})، پست‌هایش از پیش‌نمایش وب خوانده می‌شود (فقط متن/عکس/ویدیوی کوچک).`,
							{ reply_markup: kb },
						);
					}
					return ctx.reply(
						`❌ بات در کانال «${source.title}» ادمین نیست.\nاول بات را ادمین کن، بعد دوباره فوروارد کن.`,
					);
				}
			} catch (err) {
				console.error('[postScheduler] getChatMember failed:', err);
				return ctx.reply('❌ نتوانستم وضعیت بات در کانال مبدأ را بررسی کنم. مطمئن شو بات ادمین آن کانال است.');
			}

			const now = nowSeconds();
			await saveSourceRule(db, {
				sourceChannelId: source.id,
				sourceTitle: source.title ?? null,
				sourceUsername: source.username ?? null,
				targetChannelId: session.targetChannelId,
				delayMinutes: session.delayMinutes,
				addedBy: userId,
				notifyChatId: ctx.chat.id,
				now,
			});
			await clearCaptureSession(db, userId);

			await ctx.reply(
				`✅ کانال مبدأ «${source.title}» ثبت شد.\nتأخیر: ${formatDelay(session.delayMinutes)}\n\n` +
					'از این به بعد هر پست تازه‌ای در آن کانال، پیش از انتشار برایت فرستاده می‌شود.',
			);
			return openChannel(ctx, session.targetChannelId);
		}

		// حالت ۲: کپی دستی — خود پیام فورواردشده محتواست
		const reason = unsupportedReason(ctx.message as any);
		if (reason) {
			await clearCaptureSession(db, userId);
			return ctx.reply(`⛔️ این نوع پست (${reason}) پشتیبانی نمی‌شود.`);
		}

		const item = extractPostItem(ctx.message as any);
		if (!item) {
			await clearCaptureSession(db, userId);
			return ctx.reply('⛔️ از این پیام محتوایی برای کپی پیدا نشد.');
		}

		const now = nowSeconds();
		const queued = await queueManualPost(db, [item as PostItem], {
			targetChannelId: session.targetChannelId,
			delayMinutes: session.delayMinutes,
			createdBy: userId,
			now,
		});
		await clearCaptureSession(db, userId);

		if (!queued) return ctx.reply('⚠️ ثبت نشد؛ دوباره تلاش کن.');

		await notifyQueued(schedulerApi(ctx), db, queued.postId, now);
		return ctx.reply(`✅ ثبت شد برای «${targetTitle}». تأخیر: ${formatDelay(session.delayMinutes)}`);
	});

	// ── پست‌های تازه‌ی کانال مبدأ ──
	// نکته: عمداً `next()` صدا زده می‌شود تا فیچر پسوند (که بعد از این ثبت می‌شود)
	// همچنان کار کند. کپی از متنِ پیش از پسوند انجام می‌شود، که مطلوب است.
	bot.on(['channel_post', 'edited_channel_post'], async (ctx: Context, next: () => Promise<void>) => {
		try {
			const isEdit = Boolean(ctx.editedChannelPost);
			const message = (ctx.channelPost ?? ctx.editedChannelPost) as any;
			if (!message) return;

			const now = nowSeconds();

			if (isEdit) {
				const outcome = await applySourceEdit(db, message, now);
				if (outcome.action === 'updated' && !outcome.published) {
					await notifyQueued(schedulerApi(ctx), db, outcome.postId, now);
				}
				return;
			}

			const outcome = await captureSourcePost(db, message, now);
			if (outcome.action === 'unsupported') {
				console.log(`[postScheduler] unsupported post from ${message.chat?.id}: ${outcome.reason}`);
				return;
			}
			if (outcome.action === 'queued') {
				// پیش‌نمایش برای سازنده‌ی قانون (چت خصوصی خودش)
				await notifyQueued(schedulerApi(ctx), db, outcome.postId, now);
			}
		} catch (err) {
			console.error('[postScheduler] channel post handling failed:', err);
		} finally {
			return next();
		}
	});
}

import { InlineKeyboard, type Bot } from 'grammy';
import type { Env } from '../../types.js';
import { Role, roleLabel, isValidRole } from '../constants/roles.js';
import { requireRole } from '../middleware/requireRole.js';
import { UserService } from '../services/userService.js';
import { userRoleActionsKeyboard } from '../keyboards/adminPanel.js';
import { renderScreen, toast } from '../ui/render.js';
import { errorText } from '../utils/errorInfo.js';
import { cronNotifyKeyboard, cronNotifyText } from '../ui/screens.js';
import { getCronNotifyState, setCronNotifyFlag } from '../db/cronNotify.js';
import { cronNotifyFlag, isCronNotifyTarget, withCronNotifyFlag } from '../../core/settings/cronNotify.js';

/**
 * Admin / founder control panel.
 * - panel / stats / settings callbacks (previously no-ops)
 * - role management UI for founder (and EXEC_ADMIN for VIP only if desired)
 */
export function adminPanelFeature(bot: Bot, env: Pick<Env, 'my_database' | 'FOUNDER_TELEGRAM_ID'>): void {
	const userService = new UserService(env.my_database);
	const needAdmin = requireRole(Role.EXEC_ADMIN, env);
	const needFounder = requireRole(Role.FOUNDER, env);

	// Menu entry points (panel/stats/settings/help) live in features/menu.js

	// --- اعلان‌های خودکار کرون (فقط پیام، نه خودِ کرون) ---
	// چرا در پنل مدیریت و نه تنظیمات کاربر؟ چون این یک تنظیم سراسریِ ربات است و
	// گپ لاگ هم مال ادمین‌هاست؛ کاربر عادی نباید بتواند آن را قطع کند.
	bot.callbackQuery('admin:cron', needAdmin, async (ctx) => {
		const state = await getCronNotifyState(env.my_database);
		await renderScreen(ctx, cronNotifyText(state), cronNotifyKeyboard(state));
	});

	bot.callbackQuery(/^admin:cron:t:(master|cleanup|admin_sync)$/, needAdmin, async (ctx) => {
		const target = ctx.match?.[1];
		if (!isCronNotifyTarget(target)) return toast(ctx, 'کلید نامعتبر است.');

		// یک خواندن + یک نوشتن؛ وضعیت بعدی را بدون کوئری دوم می‌سازیم.
		const state = await getCronNotifyState(env.my_database);
		const next = withCronNotifyFlag(state, target, !cronNotifyFlag(state, target));

		try {
			await setCronNotifyFlag(env.my_database, target, cronNotifyFlag(next, target));
		} catch (err) {
			return toast(ctx, `ذخیره نشد: ${errorText(err)}`);
		}

		await renderScreen(ctx, cronNotifyText(next), cronNotifyKeyboard(next));
	});

	// --- Role management (founder-centric) ---

	bot.callbackQuery('admin:roles', needFounder, async (ctx) => {
		await renderScreen(
			ctx,
			'👥 <b>مدیریت نقش‌ها</b>\n\n' +
				'شناسه عددی تلگرام کاربر را بفرستید.\n\n' +
				'فرمت: <code>/setrole &lt;telegram_id&gt; &lt;level&gt;</code>\n' +
				'سطح‌ها: 0 عادی · 1 ویژه · 2 ادمین · 3 توسعه‌دهنده\n' +
				'(سطح بنیان‌گذار فقط از طریق env قابل تنظیم است.)',
			new InlineKeyboard()
				.text('📋 لیست ادمین‌ها/VIP', 'admin:list_privileged')
				.row()
				.text('« پنل مدیریت', 'm:ad')
				.text('🏠 منوی اصلی', 'm:h'),
		);
	});

	bot.callbackQuery('admin:list_privileged', needAdmin, async (ctx) => {
		const rows = await userService.listUsersWithMinRole(Role.VIP);
		if (!rows.length) {
			return renderScreen(
				ctx,
				'هنوز کاربر VIP یا بالاتری ثبت نشده.',
				new InlineKeyboard().text('« بازگشت', 'm:ad').text('🏠 منوی اصلی', 'm:h'),
			);
		}
		const text = rows
			.map((u) => {
				const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || '—';
				const un = u.username ? `@${u.username}` : '—';
				return `• <code>${u.id}</code> ${name} (${un}) — <b>${roleLabel(u.role)}</b>`;
			})
			.join('\n');
		await renderScreen(
			ctx,
			`📋 <b>کاربران دارای نقش ویژه</b>\n\n${text}`,
			new InlineKeyboard().text('« بازگشت', 'm:ad').text('🏠 منوی اصلی', 'm:h'),
		);
	});

	bot.callbackQuery(/^admin:setrole:(\d+):(\d+)$/, needFounder, async (ctx) => {
		const targetId = Number(ctx.match[1]);
		const newRole = Number(ctx.match[2]);
		await ctx.answerCallbackQuery();

		try {
			await userService.setRole(ctx.from.id, targetId, newRole, env);
			await ctx.reply(`✅ نقش کاربر <code>${targetId}</code> به <b>${roleLabel(newRole)}</b> تغییر کرد.`, { parse_mode: 'HTML' });
		} catch (err) {
			await ctx.reply(`❌ ${errorText(err)}`);
		}
	});

	bot.callbackQuery(/^admin:user:(\d+)$/, needFounder, async (ctx) => {
		const targetId = Number(ctx.match[1]);
		await ctx.answerCallbackQuery();
		const user = await userService.getUser(targetId);
		if (!user) {
			return ctx.reply('کاربر در دیتابیس پیدا نشد. اول باید با بات تعامل کرده باشد.');
		}
		const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || '—';
		await ctx.reply(`👤 <b>${name}</b>\n<code>${user.id}</code>\nنقش فعلی: <b>${roleLabel(user.role ?? 0)}</b>`, {
			parse_mode: 'HTML',
			reply_markup: userRoleActionsKeyboard(targetId, user.role ?? 0),
		});
	});

	// /setrole <id> <level> — founder only
	bot.command('setrole', needFounder, async (ctx) => {
		const parts = (ctx.message?.text || '').trim().split(/\s+/);
		if (parts.length < 3) {
			return ctx.reply('فرمت: <code>/setrole &lt;telegram_id&gt; &lt;0-3&gt;</code>', { parse_mode: 'HTML' });
		}
		const targetId = Number(parts[1]);
		const newRole = Number(parts[2]);
		const actorId = ctx.from?.id;
		if (!Number.isFinite(targetId) || !isValidRole(newRole) || actorId === undefined) {
			return ctx.reply('شناسه یا سطح نامعتبر است.');
		}
		try {
			await userService.setRole(actorId, targetId, newRole, env);
			await userService.logActivity(actorId, 'set_role', `target=${targetId} role=${newRole}`);
			await ctx.reply(`✅ نقش <code>${targetId}</code> → <b>${roleLabel(newRole)}</b>`, { parse_mode: 'HTML' });
		} catch (err) {
			await ctx.reply(`❌ ${errorText(err)}`);
		}
	});

	bot.command('whoami', async (ctx) => {
		const fromId = ctx.from?.id;
		if (!fromId) return;
		const role = await userService.getEffectiveRole(fromId, env);
		await ctx.reply(`شناسه شما: <code>${fromId}</code>\nسطح: <b>${roleLabel(role)}</b> (${role})`, { parse_mode: 'HTML' });
	});

	bot.command('getrole', needAdmin, async (ctx) => {
		const parts = (ctx.message?.text || '').trim().split(/\s+/);
		const targetId = parts[1] ? Number(parts[1]) : (ctx.from?.id ?? NaN);
		if (!Number.isFinite(targetId)) {
			return ctx.reply('فرمت: <code>/getrole &lt;telegram_id&gt;</code>', {
				parse_mode: 'HTML',
			});
		}
		const role = await userService.getEffectiveRole(targetId, env);
		const user = await userService.getUser(targetId);
		const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : '—';
		await ctx.reply(`👤 ${name}\n<code>${targetId}</code>\nسطح: <b>${roleLabel(role)}</b> (${role})`, { parse_mode: 'HTML' });
	});
}

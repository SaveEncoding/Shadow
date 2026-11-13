import type { Context, NextFunction } from 'grammy';
import { Role, roleLabel } from '../constants/roles.js';
import { UserService } from '../services/userService.js';
import type { Env } from '../../types.js';

// grammY's documented way of adding fields to the context. `requireRole` writes
// `userRole` on every request it lets through; today no handler reads it, but
// typing it here keeps the assignment honest instead of casting.
declare module 'grammy' {
	interface Context {
		/** سطح نقش مؤثر کاربر؛ توسط `requireRole` پر می‌شود. */
		userRole?: number;
	}
}

/** حداقل چیزی که این میدل‌ور از env لازم دارد */
type RoleEnv = Pick<Env, 'my_database'> & Partial<Pick<Env, 'FOUNDER_TELEGRAM_ID'>>;

/**
 * grammY middleware: require minimum role level.
 * Sets ctx.userRole and ctx.dbUser when the check passes (or on founder fallback).
 */
export function requireRole(minRole: number, env: RoleEnv) {
	const userService = new UserService(env.my_database);

	return async (ctx: Context, next: NextFunction) => {
		const fromId = ctx.from?.id;
		if (!fromId) return;

		const role = await userService.getEffectiveRole(fromId, env);
		ctx.userRole = role;

		if (role < minRole) {
			const msg = `⛔ دسترسی کافی ندارید.\nحداقل سطح لازم: <b>${roleLabel(minRole)}</b>`;
			if (ctx.callbackQuery) {
				await ctx.answerCallbackQuery({
					text: '⛔ دسترسی کافی ندارید.',
					show_alert: true,
				});
				// Also edit/reply so the user sees detail in chat when useful
				try {
					await ctx.reply(msg, { parse_mode: 'HTML' });
				} catch {
					/* ignore */
				}
			} else {
				await ctx.reply(msg, { parse_mode: 'HTML' });
			}
			return;
		}

		return next();
	};
}

/** Convenience: require EXEC_ADMIN or higher (admin panel, stats, settings). */
export function requireAdmin(env: RoleEnv) {
	return requireRole(Role.EXEC_ADMIN, env);
}

/** Convenience: require FOUNDER. */
export function requireFounder(env: RoleEnv) {
	return requireRole(Role.FOUNDER, env);
}

import { Role, roleLabel } from "../constants/roles.js";
import { UserService } from "../services/userService.js";

/**
 * grammY middleware: require minimum role level.
 * Sets ctx.userRole and ctx.dbUser when the check passes (or on founder fallback).
 *
 * @param {number} minRole
 * @param {object} env - Worker env (FOUNDER_TELEGRAM_ID, my_database, ...)
 */
export function requireRole(minRole, env) {
  const userService = new UserService(env.my_database);

  return async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;

    const role = await userService.getEffectiveRole(fromId, env);
    ctx.userRole = role;

    if (role < minRole) {
      const msg = `⛔ دسترسی کافی ندارید.\nحداقل سطح لازم: <b>${roleLabel(minRole)}</b>`;
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({
          text: "⛔ دسترسی کافی ندارید.",
          show_alert: true,
        });
        // Also edit/reply so the user sees detail in chat when useful
        try {
          await ctx.reply(msg, { parse_mode: "HTML" });
        } catch {
          /* ignore */
        }
      } else {
        await ctx.reply(msg, { parse_mode: "HTML" });
      }
      return;
    }

    return next();
  };
}

/**
 * Convenience: require EXEC_ADMIN or higher (admin panel, stats, settings).
 */
export function requireAdmin(env) {
  return requireRole(Role.EXEC_ADMIN, env);
}

/**
 * Convenience: require FOUNDER.
 */
export function requireFounder(env) {
  return requireRole(Role.FOUNDER, env);
}

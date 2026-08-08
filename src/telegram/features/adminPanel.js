import { InlineKeyboard } from "grammy";
import { Role, RoleLabel, ASSIGNABLE_ROLES, roleLabel, isValidRole } from "../constants/roles.js";
import { requireRole } from "../middleware/requireRole.js";
import { UserService } from "../services/userService.js";
import { adminPanelKeyboard, rolePickerKeyboard, userRoleActionsKeyboard } from "../keyboards/adminPanel.js";

/**
 * Admin / founder control panel.
 * - panel / stats / settings callbacks (previously no-ops)
 * - role management UI for founder (and EXEC_ADMIN for VIP only if desired)
 */
export function adminPanelFeature(bot, env) {
  const userService = new UserService(env.my_database);
  const needAdmin = requireRole(Role.EXEC_ADMIN, env);
  const needFounder = requireRole(Role.FOUNDER, env);

  // --- Menu entry points (were silent no-ops in TODO) ---

  bot.callbackQuery("panel", needAdmin, async (ctx) => {
    await ctx.answerCallbackQuery();
    const role = ctx.userRole ?? Role.NORMAL;
    await ctx.reply(
      `📊 <b>پنل مدیریت</b>\nسطح شما: <b>${roleLabel(role)}</b>`,
      { parse_mode: "HTML", reply_markup: adminPanelKeyboard(role) }
    );
  });

  bot.callbackQuery("stats", needAdmin, async (ctx) => {
    await ctx.answerCallbackQuery();
    const stats = await userService.getRoleStats();
    const lines = Object.entries(RoleLabel)
      .map(([lvl, label]) => `• ${label}: <b>${stats[Number(lvl)] ?? 0}</b>`)
      .join("\n");
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    await ctx.reply(
      `📈 <b>آمار کاربران</b>\n\n${lines}\n\nجمع: <b>${total}</b>`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery("settings", needAdmin, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "⚙️ <b>تنظیمات</b>\n\n" +
        "• برای تنظیم گپ لاگ خطا داخل گروه مورد نظر بزنید:\n<code>/seterrorlog</code>\n" +
        "• مشاهده گپ لاگ فعلی:\n<code>/geterrorlog</code>",
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery("help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "❓ <b>راهنما</b>\n\n" +
        "• <b>افزودن کانال</b>: یک پست از کانال را برای بات فوروارد کنید.\n" +
        "• <b>کانال‌های من</b>: لیست کانال‌های ثبت‌شده.\n" +
        "• <b>پنل مدیریت</b>: فقط برای ادمین‌ها.",
      { parse_mode: "HTML" }
    );
  });

  // --- Role management (founder-centric) ---

  bot.callbackQuery("admin:roles", needFounder, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "👥 <b>مدیریت نقش‌ها</b>\n\n" +
        "شناسه عددی تلگرام کاربر را بفرستید، یا از دکمه زیر برای ارتقای آخرین کاربر ثبت‌شده استفاده کنید.\n\n" +
        "فرمت: <code>/setrole &lt;telegram_id&gt; &lt;level&gt;</code>\n" +
        "سطح‌ها: 0 عادی · 1 ویژه · 2 ادمین · 3 توسعه‌دهنده\n" +
        "(سطح بنیان‌گذار فقط از طریق env قابل تنظیم است.)",
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("📋 لیست ادمین‌ها/VIP", "admin:list_privileged"),
      }
    );
  });

  bot.callbackQuery("admin:list_privileged", needAdmin, async (ctx) => {
    await ctx.answerCallbackQuery();
    const rows = await userService.listUsersWithMinRole(Role.VIP);
    if (!rows.length) {
      return ctx.reply("هنوز کاربر VIP یا بالاتری ثبت نشده.");
    }
    const text = rows
      .map((u) => {
        const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "—";
        const un = u.username ? `@${u.username}` : "—";
        return `• <code>${u.id}</code> ${name} (${un}) — <b>${roleLabel(u.role)}</b>`;
      })
      .join("\n");
    await ctx.reply(`📋 <b>کاربران دارای نقش ویژه</b>\n\n${text}`, {
      parse_mode: "HTML",
    });
  });

  bot.callbackQuery(/^admin:setrole:(\d+):(\d+)$/, needFounder, async (ctx) => {
    const targetId = Number(ctx.match[1]);
    const newRole = Number(ctx.match[2]);
    await ctx.answerCallbackQuery();

    try {
      await userService.setRole(ctx.from.id, targetId, newRole, env);
      await ctx.reply(
        `✅ نقش کاربر <code>${targetId}</code> به <b>${roleLabel(newRole)}</b> تغییر کرد.`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message || err}`);
    }
  });

  bot.callbackQuery(/^admin:user:(\d+)$/, needFounder, async (ctx) => {
    const targetId = Number(ctx.match[1]);
    await ctx.answerCallbackQuery();
    const user = await userService.getUser(targetId);
    if (!user) {
      return ctx.reply("کاربر در دیتابیس پیدا نشد. اول باید با بات تعامل کرده باشد.");
    }
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "—";
    await ctx.reply(
      `👤 <b>${name}</b>\n<code>${user.id}</code>\nنقش فعلی: <b>${roleLabel(user.role ?? 0)}</b>`,
      {
        parse_mode: "HTML",
        reply_markup: userRoleActionsKeyboard(targetId, user.role ?? 0),
      }
    );
  });

  // /setrole <id> <level> — founder only
  bot.command("setrole", needFounder, async (ctx) => {
    const parts = (ctx.message?.text || "").trim().split(/\s+/);
    if (parts.length < 3) {
      return ctx.reply(
        "فرمت: <code>/setrole &lt;telegram_id&gt; &lt;0-3&gt;</code>",
        { parse_mode: "HTML" }
      );
    }
    const targetId = Number(parts[1]);
    const newRole = Number(parts[2]);
    if (!Number.isFinite(targetId) || !isValidRole(newRole)) {
      return ctx.reply("شناسه یا سطح نامعتبر است.");
    }
    try {
      await userService.setRole(ctx.from.id, targetId, newRole, env);
      await userService.logActivity(
        ctx.from.id,
        "set_role",
        `target=${targetId} role=${newRole}`
      );
      await ctx.reply(
        `✅ نقش <code>${targetId}</code> → <b>${roleLabel(newRole)}</b>`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message || err}`);
    }
  });

  bot.command("whoami", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    const role = await userService.getEffectiveRole(fromId, env);
    await ctx.reply(
      `شناسه شما: <code>${fromId}</code>\nسطح: <b>${roleLabel(role)}</b> (${role})`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("getrole", needAdmin, async (ctx) => {
    const parts = (ctx.message?.text || "").trim().split(/\s+/);
    const targetId = parts[1] ? Number(parts[1]) : ctx.from?.id;
    if (!Number.isFinite(targetId)) {
      return ctx.reply("فرمت: <code>/getrole &lt;telegram_id&gt;</code>", {
        parse_mode: "HTML",
      });
    }
    const role = await userService.getEffectiveRole(targetId, env);
    const user = await userService.getUser(targetId);
    const name = user
      ? [user.first_name, user.last_name].filter(Boolean).join(" ")
      : "—";
    await ctx.reply(
      `👤 ${name}\n<code>${targetId}</code>\nسطح: <b>${roleLabel(role)}</b> (${role})`,
      { parse_mode: "HTML" }
    );
  });
}

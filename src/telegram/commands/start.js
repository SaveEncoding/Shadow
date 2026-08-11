import { UserService } from "../services/userService.js";
import { Role } from "../constants/roles.js";
import { homeText, homeKeyboard } from "../ui/screens.js";

/**
 * Registers the /start command on the bot.
 * Sends a single home-screen message (navigation continues via editMessage).
 */
export function startCommand(bot, env) {
  bot.command("start", async (ctx) => {
    let role = Role.NORMAL;
    try {
      if (ctx.from?.id) {
        const userService = new UserService(env.my_database);
        role = await userService.getEffectiveRole(ctx.from.id, env);
      }
    } catch (err) {
      console.error("[startCommand] role lookup failed:", err);
    }

    await ctx.reply(homeText(role), {
      parse_mode: "HTML",
      reply_markup: homeKeyboard(role),
      link_preview_options: { is_disabled: true },
    });
  });
}

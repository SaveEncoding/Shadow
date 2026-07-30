import { handleTelegramUpdate } from "./telegram/main-tel.js"
import { reportErrorToAdmin } from "./telegram/utils/Error.js"
import { handleWebsiteUpdate } from "./website/main-web.js";
import { runScheduledCleanup } from "./telegram/scheduled.js";
import { Env } from "./types.js";

export default {
  async fetch(request, env: Env, ctx) {
    try {
      const url = new URL(request.url);

      // Telegram
      if (url.pathname === "/telegram" && request.method === "POST") {
        return await handleTelegramUpdate(request, env);
      }

      // Website
      return await handleWebsiteUpdate(request, env);

    } catch (err) {
      console.error(err);
      ctx.waitUntil (
        reportErrorToAdmin(env, "Worker.fetch", err)
      );
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(event, env: Env, ctx) {
    ctx.waitUntil(runScheduledCleanup(env));
  }
};


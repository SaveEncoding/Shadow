import { handleTelegramUpdate } from "./telegram/main-tel.js"
import { reportErrorToAdmin } from "./telegram/utils/Error.js"
import { handleWebsiteUpdate } from "./website/main-web.js";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Telegram
      if (url.pathname === "/telegram" && request.method === "POST") {
        return await handleTelegramUpdate(request, env);
      }

      // Website
      return await handleWebsiteUpdate(request);

    } catch (err) {
      console.error(err);
      ctx.waitUntil (
        reportErrorToAdmin(env, "Worker.fetch", err)
      );
      return new Response("Internal Server Error", { status: 500 });
    }
  }
};


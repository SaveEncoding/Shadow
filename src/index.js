import { handleTelegramUpdate } from "./telegram/main-tel.js"
import { reportErrorToAdmin } from "./telegram/utils/error.js"

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // اینجا مربوط به تلگرامه
      if (url.pathname === "/telegram" && request.method === "POST") {
        return await handleTelegramUpdate(request, env);
      }

      // اینجا مربوط به سایته
      return env.ASSETS.fetch(request);

    } catch (err) {
      console.error(err);
      ctx.waitUntil (
        reportErrorToAdmin(env, "Worker.fetch", err)
      );
      return new Response("Internal Server Error", { status: 500 });
    }
  }
};


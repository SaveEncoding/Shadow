import { handleTelegramUpdate } from "./telegram/main-tel.js"
import { reportError } from "./telegram/utils/Error.js"
import { handleWebsiteUpdate } from "./website/main-web.js";
import { runScheduledCleanup } from "./telegram/scheduled.js";
import { refreshChannelAdmins } from "./telegram/channelAdminSync.js";
import { publishDuePosts } from "./telegram/publishQueue.js";
import { Env } from "./types.js";

const DAILY_CLEANUP_CRON = "30 23 * * *";
const CHANNEL_ADMIN_SYNC_CRON = "30 14 * * *";
const PUBLISH_QUEUE_CRON = "* * * * *";

/**
 * نقشه‌ی کرون → کار.
 *
 * قبلاً هر کرونِ ناشناخته `runScheduledCleanup` را اجرا می‌کرد؛ یعنی افزودن یک
 * کرون جدید (مثل صف انتشار که هر دقیقه اجرا می‌شود) پاکسازی روزانه را ۱۴۴۰ بار در
 * روز اجرا می‌کرد. حالا فقط عبارت‌های شناخته‌شده کار دارند و بقیه فقط لاگ می‌شوند.
 */
const CRON_HANDLERS: Record<string, (env: Env) => Promise<unknown>> = {
  [DAILY_CLEANUP_CRON]: (env) => runScheduledCleanup(env),
  [CHANNEL_ADMIN_SYNC_CRON]: (env) => refreshChannelAdmins(env),
  [PUBLISH_QUEUE_CRON]: (env) => publishDuePosts(env),
};

export default {
  async fetch(request, env: Env, ctx) {
    try {
      const url = new URL(request.url);

      // Telegram
      if (url.pathname === "/telegram" && request.method === "POST") {
        return await handleTelegramUpdate(request, env, ctx);
      }

      // Website
      return await handleWebsiteUpdate(request, env);

    } catch (err) {
      console.error(err);
      ctx.waitUntil (
        reportError(env, "Worker.fetch", err)
      );
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  async scheduled(event, env: Env, ctx) {
    const handler = CRON_HANDLERS[event.cron];

    if (!handler) {
      // کرون ناشناخته (مثلاً بعد از تغییر wrangler.jsonc پیش از deploy) نباید
      // به‌صورت تصادفی کاری را اجرا کند.
      console.warn(`[cron] no handler registered for "${event.cron}"`);
      return;
    }

    ctx.waitUntil(
      handler(env).catch(async (err) => {
        console.error(`[cron] "${event.cron}" failed:`, err);
        await reportError(env, `cron:${event.cron}`, err);
      })
    );
  }
};

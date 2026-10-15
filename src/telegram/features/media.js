// Media feature: mux subtitles into videos (MKVToolnix-like), asynchronously.
//
// Flow:
//   1. User sends a video  -> stored in R2, pending state saved (KV or memory).
//   2. User sends a .srt   -> stored in R2, a media_job is created in D1 (status=queued).
//   3. An out-of-band muxer (Queue consumer / external service) processes the job
//      and writes the result back to R2, then updates the job status.
//   4. User checks progress with /mediastatus <id>.

import { createMediaJob, getMediaJob, listMediaJobs, updateMediaJob } from "../services/mediaService.js";

const PENDING_TTL_SECONDS = 3600;

function sanitizeName(name) {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

function isVideoDocument(doc) {
  return !!doc && (doc.mime_type || "").startsWith("video/");
}

function isSubtitleDocument(doc) {
  if (!doc) return false;
  const name = (doc.file_name || "").toLowerCase();
  return name.endsWith(".srt") || name.endsWith(".vtt") || name.endsWith(".ass");
}

async function downloadTelegramFile(env, fileId) {
  const metaRes = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const meta = await metaRes.json();
  if (!meta.ok || !meta.result?.file_path) {
    throw new Error("Could not resolve Telegram file path");
  }
  const filePath = meta.result.file_path;
  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${filePath}`
  );
  if (!fileRes.ok) throw new Error("Could not download Telegram file");
  const buffer = await fileRes.arrayBuffer();
  return { buffer, filePath };
}

async function uploadToR2(env, key, buffer, contentType) {
  if (!env.MEDIA_BUCKET) throw new Error("R2 bucket MEDIA_BUCKET is not configured");
  await env.MEDIA_BUCKET.put(key, buffer, {
    httpMetadata: { contentType: contentType || "application/octet-stream" },
  });
  return key;
}

async function getPending(env, userId, memoryMap) {
  const kvKey = `media:pending:${userId}`;
  if (env?.ERROR_KV) {
    try {
      const raw = await env.ERROR_KV.get(kvKey);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error("KV read pending failed:", e);
    }
  }
  return memoryMap.get(userId) || null;
}

async function setPending(env, userId, value, memoryMap) {
  const kvKey = `media:pending:${userId}`;
  memoryMap.set(userId, value);
  if (env?.ERROR_KV) {
    try {
      await env.ERROR_KV.put(kvKey, JSON.stringify(value), {
        expirationTtl: PENDING_TTL_SECONDS,
      });
    } catch (e) {
      console.error("KV write pending failed:", e);
    }
  }
}

async function clearPending(env, userId, memoryMap) {
  memoryMap.delete(userId);
  if (env?.ERROR_KV) {
    try {
      await env.ERROR_KV.delete(`media:pending:${userId}`);
    } catch (e) {
      console.error("KV delete pending failed:", e);
    }
  }
}

export function mediaFeature(bot, env) {
  const memoryPending = new Map();

  bot.command("media", async (ctx) => {
    const userId = ctx.from?.id;
    const jobs = userId ? await listMediaJobs(env.my_database, userId, 5) : [];
    let text = "🎬 ادغام ویدیو و زیرنویس (MKVToolnix-like)\n\n";
    text += "1) یک فایل ویدیو بفرستید.\n";
    text += "2) سپس فایل .srt (یا .vtt/.ass) را بفرستید.\n";
    text += "3) پردازش در پس‌زمینه انجام می‌شود.\n";
    text += "4) وضعیت: /mediastatus <id>\n\n";
    if (jobs.length) {
      text += "آخرین کارها:\n";
      for (const j of jobs) {
        text += `#${j.id} — ${j.status}${j.result_key ? " ✅" : ""}\n`;
      }
    } else {
      text += "هنوز کاری ثبت نشده.";
    }
    await ctx.reply(text);
  });

  bot.command("mediastatus", async (ctx) => {
    const arg = (ctx.message?.text || "").split(/\s+/)[1];
    const id = Number(arg);
    if (!id) {
      await ctx.reply("استفاده: /mediastatus <id>");
      return;
    }
    const job = await getMediaJob(env.my_database, id);
    if (!job) {
      await ctx.reply("کاری با این شناسه پیدا نشد.");
      return;
    }
    let text = `کار #${job.id}: ${job.status}`;
    if (job.result_key) text += `\nنتیجه: ${job.result_key}`;
    if (job.error) text += `\nخطا: ${job.error}`;
    await ctx.reply(text);
  });

  async function handleVideo(ctx) {
    const userId = ctx.from?.id;
    if (!userId) return;
    const docOrVideo = ctx.message.video || ctx.message.document;
    const fileId = docOrVideo?.file_id;
    const fileName = docOrVideo?.file_name || docOrVideo?.file_unique_id || "video";
    const mimeType = docOrVideo?.mime_type || "video/mp4";
    if (!fileId) {
      await ctx.reply("فایل ویدیو معتبر نیست.");
      return;
    }
    await ctx.reply("⏳ در حال دریافت ویدیو...");
    try {
      const { buffer } = await downloadTelegramFile(env, fileId);
      const key = `media/${userId}/video-${Date.now()}-${sanitizeName(fileName)}`;
      await uploadToR2(env, key, buffer, mimeType);
      await setPending(env, userId, { videoKey: key, videoName: fileName }, memoryPending);
      await ctx.reply("✅ ویدیو ذخیره شد. حالا فایل .srt را بفرستید.");
    } catch (err) {
      console.error("[media] video upload failed:", err);
      await ctx.reply(`❌ خطا در دریافت ویدیو: ${err.message || err}`);
    }
  }

  async function handleSubtitle(ctx) {
    const userId = ctx.from?.id;
    if (!userId) return;
    const doc = ctx.message.document;
    const fileId = doc?.file_id;
    const fileName = doc?.file_name || "subtitle.srt";
    const mimeType = doc?.mime_type || "text/plain";
    if (!fileId) {
      await ctx.reply("فایل زیرنویس معتبر نیست.");
      return;
    }

    const pending = await getPending(env, userId, memoryPending);
    if (!pending?.videoKey) {
      await ctx.reply("ابتدا یک ویدیو بفرستید، سپس فایل .srt را ارسال کنید.");
      return;
    }

    await ctx.reply("⏳ در حال دریافت زیرنویس و ثبت کار...");
    try {
      const { buffer } = await downloadTelegramFile(env, fileId);
      const key = `media/${userId}/sub-${Date.now()}-${sanitizeName(fileName)}`;
      await uploadToR2(env, key, buffer, mimeType);

      const jobId = await createMediaJob(env.my_database, {
        userId,
        videoKey: pending.videoKey,
        subtitleKey: key,
      });
      await clearPending(env, userId, memoryPending);

      await ctx.reply(
        `✅ کار #${jobId} ثبت شد (status: queued).\n` +
          "پردازش در پس‌زمینه انجام می‌شود. با /mediastatus " +
          jobId +
          " وضعیت را ببینید."
      );

      // Optional: notify an external muxer service.
      if (env.MEDIA_MUXER_URL) {
        try {
          await fetch(env.MEDIA_MUXER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
        } catch (e) {
          console.error("[media] muxer notify failed:", e);
        }
      }
    } catch (err) {
      console.error("[media] subtitle/job failed:", err);
      await ctx.reply(`❌ خطا: ${err.message || err}`);
    }
  }

  bot.on("message:video", handleVideo);

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (isVideoDocument(doc)) {
      // Treat as video upload.
      ctx.message.video = null;
      await handleVideo(ctx);
    } else if (isSubtitleDocument(doc)) {
      await handleSubtitle(ctx);
    } else {
      // ignore unrelated documents
    }
  });
}
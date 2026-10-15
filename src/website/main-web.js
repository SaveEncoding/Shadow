import indexHtml from "./view/index.html";
import {
  getMediaJob,
  getQueuedMediaJobs,
  updateMediaJob,
} from "../telegram/services/mediaService.js";
import aboutHtml from "./view/about.html";
import notFoundHtml from "./view/404.html";
import telegramHtml from "./view/telegram.html";
import logoImage from "./view/image-1.jpg";
import siteStyles from "./view/styles.css";
import siteScript from "./view/script.js.txt";

// آدرس کنونیکال هر صفحه؛ همینجا برای صفحه‌ی جدید یه ورودی اضافه کن
const HTML_PAGES = {
  "/": indexHtml,
  "/about": aboutHtml,
  "/telegram": telegramHtml,
};

// آدرس‌های قدیمی/جایگزین که باید به نسخه‌ی کنونیکال ریدایرکت بشن
// (جلوگیری از duplicate content برای سئو - گوگل هر دو رو یه صفحه‌ی جدا حساب نکنه)
const REDIRECTS = {
  "/index.html": "/",
  "/about.html": "/about",
  "/telegram.html": "/telegram",
};

// فایل‌های باینری (عکس، فونت و غیره) که مستقیم توی بیلد Worker باندل می‌شن
const BINARY_ASSETS = {
  "/image-1.jpg": { data: logoImage, contentType: "image/jpeg" },
};

// فایل‌های متنی (CSS / JS) که به صورت رشته باندل و از همون origin سرو می‌شن.
// نکته: اسکریپت سمت مرورگر با پسوند "script.js.txt" ذخیره شده تا esbuild/wrangler
// اون رو متن خام در نظر بگیره، نه اینکه بخواد به عنوان کد داخل Worker اجراش کنه.
const TEXT_ASSETS = {
  "/styles.css": { data: siteStyles, contentType: "text/css; charset=UTF-8", maxAge: 300 },
  "/script.js": { data: siteScript, contentType: "text/javascript; charset=UTF-8", maxAge: 300 },
};

const ROBOTS_TXT = "User-agent: *\nAllow: /\n";

// هدرهای امنیتی پایه‌ای که روی تمام پاسخ‌ها اعمال می‌شن
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self'; base-uri 'self'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function withCommonHeaders(headers) {
  return { ...SECURITY_HEADERS, ...headers };
}

function htmlResponse(html, status, method) {
  return new Response(method === "HEAD" ? null : html, {
    status,
    headers: withCommonHeaders({
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "public, max-age=300",
    }),
  });
}

function redirectResponse(location) {
  return new Response(null, {
    status: 301,
    headers: withCommonHeaders({
      Location: location,
    }),
  });
}

function textResponse(body, contentType, maxAge, method) {
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: withCommonHeaders({
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${maxAge}`,
    }),
  });
}

function binaryResponse(data, contentType, method) {
  return new Response(method === "HEAD" ? null : data, {
    status: 200,
    headers: withCommonHeaders({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    }),
  });
}

export async function handleWebsiteUpdate(request, env) {
  const url = new URL(request.url);
  const method = request.method;

  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: withCommonHeaders({ Allow: "GET, HEAD" }),
    });
  }

  let pathname = url.pathname;

  // نرمالایز کردن اسلش انتهایی (به جز خود روت "/")
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  if (pathname === "/robots.txt") {
    return textResponse(ROBOTS_TXT, "text/plain; charset=UTF-8", 3600, method);
  }

  const redirectTarget = REDIRECTS[pathname];
  if (redirectTarget) {
    const destination = new URL(redirectTarget + url.search, url);
    return redirectResponse(destination.toString());
  }

  const binary = BINARY_ASSETS[pathname];
  if (binary) {
    return binaryResponse(binary.data, binary.contentType, method);
  }

  const textAsset = TEXT_ASSETS[pathname];
  if (textAsset) {
    return textResponse(textAsset.data, textAsset.contentType, textAsset.maxAge, method);
  }

  const page = HTML_PAGES[pathname];
  if (page) {
    return htmlResponse(page, 200, method);
  }

  // --- Media API (for external muxer services) ---
  if (pathname.startsWith("/api/media/")) {
    // Simple shared-secret auth when configured.
    if (env.MEDIA_API_SECRET) {
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.MEDIA_API_SECRET}`) {
        return new Response("Unauthorized", { status: 401, headers: withCommonHeaders({}) });
      }
    }

    // GET /api/media/jobs?status=queued
    if (pathname === "/api/media/jobs" && method === "GET") {
      const status = url.searchParams.get("status");
      let jobs = [];
      if (status === "queued") {
        jobs = await getQueuedMediaJobs(env.my_database, 10);
      }
      return new Response(JSON.stringify({ jobs }), {
        status: 200,
        headers: withCommonHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
      });
    }

    // GET /api/media/jobs/:id
    const jobMatch = pathname.match(/^\/api\/media\/jobs\/(\d+)$/);
    if (jobMatch && method === "GET") {
      const job = await getMediaJob(env.my_database, Number(jobMatch[1]));
      if (!job) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: withCommonHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
        });
      }
      return new Response(JSON.stringify({ job }), {
        status: 200,
        headers: withCommonHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
      });
    }

    // POST /api/media/jobs/:id/complete
    const completeMatch = pathname.match(/^\/api\/media\/jobs\/(\d+)\/complete$/);
    if (completeMatch && method === "POST") {
      const id = Number(completeMatch[1]);
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        body = {};
      }
      if (body.resultKey) {
        await updateMediaJob(env.my_database, id, { status: "done", resultKey: body.resultKey });
      } else if (body.error) {
        await updateMediaJob(env.my_database, id, { status: "failed", error: String(body.error) });
      } else {
        await updateMediaJob(env.my_database, id, { status: "processing" });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: withCommonHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
      });
    }

    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: withCommonHeaders({ "Content-Type": "application/json; charset=UTF-8" }),
    });
  }

  return htmlResponse(notFoundHtml, 404, method);
}
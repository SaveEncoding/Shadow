import indexHtml from "./view/index.html";
import aboutHtml from "./view/about.html";
import notFoundHtml from "./view/404.html";
import telegramHtml from "./view/telegram.html";
import logoImage from "./view/image-1.jpg";

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

const ROBOTS_TXT = "User-agent: *\nAllow: /\n";

// هدرهای امنیتی پایه‌ای که روی تمام پاسخ‌ها اعمال می‌شن
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; form-action 'self'",
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

  const page = HTML_PAGES[pathname];
  if (page) {
    return htmlResponse(page, 200, method);
  }

  return htmlResponse(notFoundHtml, 404, method);
}
# معماری Shadow

> دستیار همه‌کاره‌ی Shadow — تلگرام‌محور، ولی نه تلگرام‌وابسته.
> نسخه‌ی سند: ۱ — تاریخ: ۱۴۰۵/۰۷/۲۴ (2026-10-16)
> وضعیت: **پیشنهاد طراحی** (هنوز پیاده نشده). نقشه‌ی اجرا در [`ROADMAP.md`](./ROADMAP.md).

---

## ۰. خلاصه‌ی یک‌صفحه‌ای

Shadow امروز یک Worker واحد است که هم وب‌سایت را سرو می‌کند و هم وبهوک تلگرام را؛ منطق تجاری‌اش
مستقیم به `grammy`، به `D1` و به «مدل اجرای Cloudflare» گره خورده است. این برای سه فیچر فعلی
(مدیریت کانال، پسوند خودکار، پنل) کافی است، اما برای سه فیچر بعدی — **مدیریت چت‌ها، شبیه‌سازی شطرنج،
و ادغام زیرنویس با ویدیو** — کافی نیست، چون این سه از سه دنیای متفاوت‌اند:

| فیچر | جنس بار کاری | گلوگاه اصلی |
|---|---|---|
| مدیریت کانال/چت | I/O + منطق مجوز | نرخ درخواست Telegram API |
| شطرنج | CPU + حالتِ زنده‌ی per-game | همزمانی، تایمر نوبت، ترتیب حرکت‌ها |
| ادغام SRT + ویدیو | **CPU سنگین + فایل بزرگ** | نه CPU سقف‌دار Worker، نه سقف ۲۰MB دانلود |

بنابراین معماری هدف سه چیز را از هم **جدا** می‌کند که امروز قاطی‌اند:

1. **هسته‌ی دامنه** (منطق خالص: قواعد شطرنج، پارس زیرنویس، ساخت «نقشه‌ی mux»، قواعد دسترسی)
2. **سطح داده** (D1 / Durable Objects / KV / R2)
3. **سطح اجرا** (کجا ffmpeg و Stockfish واقعاً اجرا می‌شوند)

و یک قاعده‌ی آهنین روی همه:

> **قاعده‌ی طلایی:** Worker هرگز روی بایت‌های فایل مدیا نمی‌نشیند و هرگز کار CPU-سنگین نمی‌کند.
> Worker فقط *تصمیم می‌گیرد، هماهنگ می‌کند، و به کاربر خبر می‌دهد*.

خروجی این سند یک ساختار پوشه‌ی مشخص، تعدادی قرارداد (interface) مشخص، یک اسکیمای داده‌ی مشخص،
و یک لیست از بدهی‌های فنی *واقعی* موجود در کد فعلی است.

### اصول راهنما (۶ اصل)

| # | اصل | یعنی چه |
|---|---|---|
| ۱ | **هسته‌ی خالص** | `src/core` هیچ import ای از `grammy`، `D1`، `Hono`، `node:*` ندارد. فقط TypeScript خالص. تست‌پذیر در میلی‌ثانیه. |
| ۲ | **مرزِ وابستگی یک‌طرفه** | `core → app → ports → adapters`. هیچ‌وقت برعکس. (هیچ `import` از `adapters` داخل `core`.) |
| ۳ | **قابل‌جای‌گزینی سطح اجرا** | «اجرای رسانه» یک پورت است با چند پیاده‌سازی: نود بیرونی، Cloudflare Container، کلاینت. فیچر نمی‌داند کدام است. |
| ۴ | **حالت کاربر جای درستی دارد** | حالت گفت‌وگو per-user در Durable Object، نه در `Map` درون‌ایزوله. حالت بازی per-game در DO. داده‌ی رابطه‌ای در D1. فایل در R2. |
| ۵ | **هر فیچر یک پلاگین خودتوصیف** | هر فیچر `manifest` دارد: منو، دسترسی، دستور، مهاجرت، کرون، flag. افزودن فیچر = افزودن یک پوشه + یک خط در رجیستری. |
| ۶ | **شکست‌ها جزو طراحی‌اند** | idempotency، lease، retry، تایم‌اوت، سهمیه‌ی کاربر، پیام خطای انسانی — از روز اول، نه بعداً. |

---

## ۱. تصویر کلان

```
                                   ┌──────────────────────────────┐
   Telegram  ──────webhook────────▶│                              │
   (cloud / local Bot API)         │        CONTROL PLANE         │
                                   │      Cloudflare Worker       │
   کاربر وب ───────HTTP───────────▶│                              │
   Mini App ───────HTTP───────────▶│  ┌────────┐  ┌────────────┐  │
                                   │  │ router │→ │ use-cases  │  │
                                   │  └────────┘  └─────┬──────┘  │
                                   │                    │ ports   │
                                   └────────┬───────────┴─────────┘
                                            │
        ┌───────────────────────────────────┼────────────────────────────────┐
        │                                   │                                │
   ┌────▼─────┐   ┌──────────┐   ┌──────────▼────────┐   ┌───────────┐  ┌─────▼─────┐
   │   D1     │   │   KV     │   │  Durable Objects  │   │    R2     │  │  Queues   │
   │  رکورد   │   │ throttle │   │ session/game/job  │   │ artifacts │  │  fan-out  │
   │  رابطه‌ای │   │  / dedupe│   │ coordination      │   │ staging   │  │   DLQ     │
   └──────────┘   └──────────┘   └──────────┬────────┘   └───────────┘  └───────────┘
                                            │  claim / progress / complete
                                            │  (HMAC-signed internal API)
                              ┌─────────────▼──────────────────────────┐
                              │           EXECUTION PLANE              │
                              │                                        │
                              │  ┌──────────────────────────────────┐  │
                              │  │  Worker Node (VPS / Container)   │  │
                              │  │  ffmpeg · mkvmerge · stockfish   │  │
                              │  │  Local Bot API Server (2GB files)│  │
                              │  └──────────────────────────────────┘  │
                              │                                        │
                              │  ┌──────────────────────────────────┐  │
                              │  │  Client (Mini App: WebCodecs)    │  │
                              │  └──────────────────────────────────┘  │
                              └────────────────────────────────────────┘
```

سه سطح، سه مسئولیت:

| سطح | چه چیزی | چه چیزی نه | مقیاس |
|---|---|---|---|
| **کنترل** (Worker) | مسیریابی، احراز هویت، سهمیه، وضعیت job، پیام‌های UI، لاگ، کرون | ffmpeg، فایل بزرگ، حلقه‌ی طولانی | افقی، بی‌حالت |
| **داده** | D1 رکورد رابطه‌ای، DO هماهنگی، R2 بایت، KV موقت | منطق تصمیم‌گیری | مدیریت‌شده |
| **اجرا** | CPU سنگین، دیسک، شبکه‌ی فایل، دسترسی به Telegram API محلی | تصمیم محصول، احراز هویت کاربر | افقی، قابل‌اضافه‌کردن |

---

## ۲. چرا این تفکیک؟ (استدلال فنی با عدد)

اینها محدودیت‌های رسمی امروزند، نه حدس:

| محدودیت | مقدار | تأثیر معماری |
|---|---|---|
| حافظه‌ی هر ایزوله Worker | **۱۲۸ MB** — [`developers.cloudflare.com/workers/platform/limits`](https://developers.cloudflare.com/workers/platform/limits/) | بافر کردن یک ویدیوی ۲۰۰MB در Worker غیرممکن است → استریم اجباری یا عبور از Worker |
| CPU هر درخواست | ۱۰ms رایگان / ۳۰s پیش‌فرض پلن پرداختی (تا ۵ دقیقه قابل افزایش) | ترنسکد ویدیو غیرممکن؛ حتی رندر SVG سنگین هم باید حساب شود |
| مدت اجرای Cron | ۱۵ دقیقه | پاکسازی‌های بلندمدت باید بچ‌بچ شوند (الگوی موجود در `channelAdminSync.js` درست است) |
| اندازه‌ی باندل Worker | ۶۴ MiB (فشرده‌نشده) | کل باینری ffmpeg.wasm (~۳۰MB) *از نظر اندازه* جا می‌شود ولی *از نظر CPU و نبود دیسک* کار نمی‌کند |
| دانلود فایل از تلگرام (`getFile`) | **۲۰ MB** | بدون سرور Bot API محلی، هیچ فایل جدی‌ای قابل پردازش نیست |
| آپلود فایل به تلگرام (multipart) | ۵۰ MB | خروجی mux اغلب بزرگ‌تر است |
| `callback_data` | ۶۴ بایت | شناسه‌ها باید کوتاه و کدگذاری‌شده باشند (امروز در `m:c:<id>` رعایت شده) |
| طول متن / کپشن | ۴۰۹۶ / ۱۰۲۴ کاراکتر | خروجی‌های AI و گزارش‌ها باید chunk شوند |
| نرخ کلی ارسال | ~۳۰ پیام/ثانیه به‌طور کلی، سخت‌گیرانه‌تر per-chat | نیاز به throttler + auto-retry (امروز **نداریم**) |
| اجرای DO | درخواست/همزمانی نامحدود تا وقتی caller وصل است؛ alarm تا ۱۵ دقیقه | «حالت زنده» و هماهنگی job باید در DO باشد، نه در Cron |

**نتیجه‌ی مستقیم:** «ffmpeg روی Worker» یک بن‌بست است (نه دیسک، نه process، نه CPU کافی).
پس یا باید بیرون از Worker اجرا شود، یا سمت کلاینت. این تصمیم در بخش ۹ به یک پورت
(`MediaRunner`) تبدیل می‌شود تا *هر سه* گزینه قابل‌جای‌گزینی باشند — چیزی که شما خواستید.

---

## ۳. ساختار پوشه‌ها (هدف)

```
src/
├── core/                      # ⓪ منطق خالص — صفر وابستگی خارجی
│   ├── chess/                 # قواعد، SAN/PGN، رندر، جست‌وجوی موتور
│   ├── subtitle/              # پارس/ساخت SRT·VTT·ASS، زمان‌بندی، کدگذاری
│   ├── media/                 # MuxPlan + ساخت argv (منطق MKVToolNix-مانند)
│   ├── space/                 # سیاست کانال/گروه: پسوند، فیلتر، خوش‌آمد
│   ├── access/                # نقش‌ها و capability ها (توابع خالص)
│   ├── text/                  # escapeHtml واحد، برش امن، entity، واژه‌نامه فارسی
│   └── errors/                # UserFacingError / CriticalError / Result
│
├── app/                       # ① use-case ها — فقط به ports وابسته‌اند
│   ├── media/                 # submitMuxJob · burnSubtitles · probeMedia
│   ├── chess/                 # startGame · playMove · resignGame · joinAsSpectator
│   ├── space/                 # registerSpace · setSuffix · moderatePost · syncAdmins
│   ├── assistant/             # askAssistant · summarizePost
│   └── admin/                 # setRole · broadcast · stats
│
├── ports/                     # ② قراردادها (فقط type، بدون پیاده‌سازی)
│   ├── messenger.ts           # ارسال/ویرایش پیام، مستقل از تلگرام
│   ├── repositories.ts        # UserRepo, SpaceRepo, JobRepo, GameRepo, SettingsRepo
│   ├── job-queue.ts           # claim/lease/progress/complete
│   ├── media-runner.ts        # ffmpeg/mkvmerge/stockfish
│   ├── blob-store.ts          # R2
│   ├── session-store.ts       # حالت per-user (DO)
│   ├── rate-limiter.ts · scheduler.ts · clock.ts · logger.ts · ai.ts
│
├── adapters/                  # ③ پیاده‌سازی‌ها — یک آداپتور، یک تکنولوژی
│   ├── telegram/              # grammy: webhook، keyboards، render، command registry
│   ├── d1/  kv/  r2/  do/     # پورت‌های داده
│   ├── media/node/            # کلاینت Worker Node (HTTP + HMAC)
│   ├── media/container/       # Cloudflare Containers (آینده)
│   ├── media/client/          # تحویل نقشه به Mini App
│   ├── ai/gemini/  ai/workers-ai/
│   └── http/                  # API v1 برای وب/CLI/Mini App
│
├── features/                  # ④ پلاگین‌ها — اتصال UI ↔ use-case
│   ├── registry.ts            # تنها جایی که فیچرها فهرست می‌شوند
│   ├── channels/              # (مهاجرت‌یافته از telegram/features/channels.js)
│   ├── suffix/  menu/  admin/  stats/
│   ├── chess/                 # manifest + handlers + screens
│   └── media/                 # manifest + handlers + screens + progress
│
├── platform/                  # ⑤ چسب Cloudflare
│   ├── worker.ts              # fetch + scheduled + queue + alarm
│   ├── cron-router.ts         # نگاشت صریح cron → job
│   ├── context.ts             # AsyncLocalStorage: traceId, userId, executionCtx
│   ├── env.ts                 # اعتبارسنجی Env در بوت
│   └── composition.ts         # ساخت یک‌باره‌ی deps در هر ایزوله
│
├── website/                   # بدون تغییر ساختاری
└── index.ts                   # فقط re-export از platform/worker.ts
```

### درخت وابستگی (تنها جهات مجاز)

```
core ◀── app ◀── ports ◀── adapters ◀── platform
  ▲                                        │
  └────────── features ────────────────────┘
              (features فقط: core + app + ports)
```

اگر روزی `grep -r "grammy" src/core` جوابی داد، دلیلی برای برگشت PR است.

---

## ۴. لایه‌ی ⓪ — هسته‌ی دامنه (`src/core`)

خصوصیات اجباری: بدون I/O، بدون `await` روی شبکه، بدون `Date.now()` مستقیم (زمان تزریق می‌شود)،
تصمیم‌هایش **قطع‌ی** (deterministic) تا با seed یکسان، خروجی یکسان بدهد. این قطعیت شرط لازم
«شبیه‌سازی» شطرنج است.

### ۴.۱ شطرنج (`core/chess`)

| فایل | مسئولیت | چرا خالص |
|---|---|---|
| `position.ts` | نمایش حالت: آرایه‌ی ۶۴ خانه + نوبت + حقوق قلعه + مربع en-passant + ساعت‌ها | سریال‌پذیر به FEN، قابل‌ذخیره در D1 و DO |
| `movegen.ts` | تولید حرکت شبه‌قانونی + فیلتر قانونی (کیش/شاخ/پین بهینه) | سنگین‌ترین بخش؛ باید قابل پروفایل باشد |
| `make-move.ts` | اعمال حرکت + undo (برای جست‌وجوی موتور) | بدون تخصیص حافظه‌ی اضافه → سریع در بودجه‌ی CPU |
| `san.ts` | خواندن/نوشتن SAN با رفع ابهام (Nbd2، exd5، e8=Q+) | نمایش به کاربر و ذخیره‌ی PGN |
| `rules.ts` | کیش‌ومات، پات، بی‌ماده‌بودن، قاعده‌ی ۵۰ حرکت، تکرار سه‌باره، تساوی توافقی، باخت به‌خاطر وقت | تصمیم نهایی بازی اینجاست، نه در DO |
| `pgn.ts` | سریال‌سازی بازی، هدرها، کامنت‌ها، ساعت | خروجی ماندگار و قابل‌اشتراک |
| `render-text.ts` | تخته‌ی یونیکد برای `<pre>` تلگرام، با برچسب فارسی و چرخش بر اساس رنگ کاربر | بدون تصویر = بدون CPU، بدون وابستگی |
| `engine/` | `search.ts` (negamax + alpha-beta + جدول جابه‌جایی + quiescence + iterative deepening)، `eval.ts` (ماده + PST)، `book.ts` (کتاب شروع کوچک JSON) | تنها بخش CPU-بر است؛ باید مستقل و محدود به بودجه باشد |
| `notation-fa.ts` | نام فارسی مهره‌ها (ش، ف، ر، س، و، ط) برای نمایش، در حالی که PGN استاندارد می‌ماند | رعایت UX فارسی بدون شکستن استاندارد |

**راهبرد تست:** شطرنج تنها جایی است که یک شاخص مطلق داریم — **perft**. اگر تولید حرکت اشتباه
باشد، perft شکست می‌خورد. این جدول را به‌عنوان تست طلایی می‌گذاریم:

```
startpos:  perft(1)=20   perft(2)=400   perft(3)=8902   perft(4)=197281  perft(5)=4865609
Kiwipete:  perft(1)=48   perft(2)=2039  perft(3)=97862  perft(4)=4085603
Position3: perft(1)=14   perft(2)=191   perft(3)=2812   perft(4)=43238
Position4: perft(1)=6    perft(2)=264   perft(3)=9467   perft(4)=422333
```
اینجا هدف پوشش کد نیست؛ هدف **درست بودن قواعد** است.

**صادقانه درباره‌ی قدرت موتور:** یک negamax با PST + quiescence در depth ۴–۶ روی JS، روی Worker
در بازه‌ی ~۱–۳ ثانیه، حریفی در سطح تقریبی ۱۲۰۰–۱۶۰۰ است. Stockfish نیست. اگر حریف قوی‌تر
می‌خواهید، راهش همان معماری سطح اجراست: `capability: "chess.engine.uci"` روی Worker Node
(Stockfish نصب‌شده) — بدون تغییر در هسته یا فیچر.

### ۴.۲ زیرنویس (`core/subtitle`)

- `parse-srt.ts` / `parse-vtt.ts` / `parse-ass.ts` → یک مدل واحد `SubtitleTrack { cues: Cue[] }`.
- تحمل خرابی‌های واقعیِ فایل‌های فارسی: BOM، پایان‌خط `\r\n`، شماره‌گذاری شکسته،
  کرونولوژی غیرصعودی، هم‌پوشانی زمانی، اعداد فارسی، جهت‌نماهای RTL/LTR، فایل‌های Windows-1252/1256.
  **کدگذاری**: تشخیص خودکار با heuristic (وجود بایت‌های 0x80–0x9F) و تبدیل به UTF-8؛
  این تک‌قلم، ۸۰٪ شکایت‌های «زیرنویس قاطی‌زبان» را حل می‌کند.
- `to-ass.ts` برای استایل‌دهی (فونت، سایه، موقعیت) وقتی کاربر هاردساب می‌خواهد.
- `transform.ts`: جابه‌جایی زمانی (`shift`)، تغییر نرخ فریم (`fps`)، ادغام دو فایل، حذف تکراری.
- `validate.ts`: بررسی قبل از ارسال به ffmpeg تا خطای ffmpeg به کاربر نشت نکند.

### ۴.۳ مدیا (`core/media`) — «مغزِ MKVToolNix-مانند»

اینجا مهم‌ترین تصمیم طراحی این فیچر است:

> **نقشه از اجرا جدا است.** Worker *نقشه* را می‌سازد (خالص، تست‌پذیر، میلی‌ثانیه‌ای)؛
> نود فقط آن را *اجرا* می‌کند. یعنی اگر فردا ffmpeg را با mkvmerge عوض کنید، یا اجرا را
> به Cloudflare Container ببرید، یا به مرورگر، **هیچ منطق محصولی تغییر نمی‌کند.**

```ts
// core/media/plan.ts  (تایپ‌های نمونه — پیاده‌سازی در فاز ۳)
export interface MuxRequest {
  video:   MediaInput;                    // مسیر/مرجع ورودی اول
  audio?:  MediaInput[];                  // ورودی‌های صوتی اضافی
  subtitles: SubtitleInput[];             // زبان، عنوان، default/forced، srt|ass|vtt
  output:  { container: "mkv" | "mp4"; filename?: string };
  policy:  "copy" | "burn" | "transcode"; // copy = بدون کدگذاری مجدد (سریع، بی‌اتلاف)
  offsetMs?: number;                      // هم‌زمان‌سازی
  chapters?: Chapter[];
  attachments?: Attachment[];             // فونت‌ها برای ASS
}

export interface MuxPlan {
  version: 1;
  tool: "ffmpeg" | "mkvmerge";
  steps: PlanStep[];                      // probe → mux → verify
  expected: { container: string; tracks: TrackSpec[] };
  warnings: PlanWarning[];                // «MKV را پلیر تلگرام پخش نمی‌کند» و مانند آن
}

export function planMux(req: MuxRequest, probe: ProbeResult): MuxPlan;
export function renderArgv(step: PlanStep): string[];   // argv آماده‌ی exec، بدون shell
```

سه خروجی برای یک درخواست مَشتری («این فیلم + این زیرنویس»):

| حالت | ابزار | زمان تقریبی (۱۰۰MB، ۲ vCPU) | نتیجه |
|---|---|---|---|
| **soft-sub در MKV** (`policy: copy`) | mkvmerge یا `ffmpeg -c copy` | ۵–۲۰ ثانیه | بی‌اتلاف، زیرنویس خاموش/روشن، فونت‌ها ضمیمه |
| **هاردساب در MP4** (`policy: burn`) | ffmpeg + libx264/NVENC | ۰.۳–۱ برابر زمان واقعی ویدیو (۳۰ دقیقه ویدیو ≈ ۱۰–۶۰ دقیقه) | در پلیر تلگرام و واتساپ دیده می‌شود |
| **MP4 + فایل SRT جدا** | بدون کدگذاری | ثانیه‌ای | سبک؛ کاربر با پلیر خودش استفاده می‌کند |

`warnings` نکته‌ی کلیدی UX است: پلیرهای تلگرام عموماً زیرنویس نرم را نمایش نمی‌دهند؛ پس اگر کاربر
هدفش «دیدن در تلگرام» است، باید از قبل به او بگوییم MKV برای آرشیو و پلیر بیرونی است و برای تلگرام
هاردساب لازم است. این تصمیم *در هسته* گرفته می‌شود و در *UI* فقط نمایش داده می‌شود.

### ۴.۴ دسترسی (`core/access`)

نقش‌های سلسله‌مراتبی فعلی (`NORMAL=0 … FOUNDER=4`) خوب‌اند و می‌مانند، ولی فیچرها نباید به
«عدد نقش» وابسته باشند. یک لایه‌ی **capability** اضافه می‌کنیم:

```ts
export type Capability =
  | "space:manage" | "space:suffix" | "space:moderate"
  | "media:mux"    | "media:burn"   | "media:large-file"
  | "chess:play"   | "chess:engine-match" | "chess:rated"
  | "ai:ask"       | "admin:roles"  | "admin:broadcast";

export function capabilitiesFor(role: Role, flags: UserFlag[]): Set<Capability>;
export function can(actor: AccessContext, cap: Capability, resource: ResourceRef): boolean;
```
سود فوری: افزودن «سهمیه» و «flag آزمایشی» بدون دست‌زدن به ۲۰ فایل، و پاسخ‌دادن به این سؤال که
«چرا این کاربر دکمه را می‌بیند ولی خطا می‌گیرد؟» با یک تابع خالص.

### ۴.۵ متن (`core/text`)

`escapeHtml` امروز در **سه جا** کپی شده (`services/telegramService.js`، `utils/Error.ts`،
`features/channelSuffix.js`). یک نسخه می‌شود + توابع `truncateForTelegram()`، `chunkForTelegram()`
(بریدن امن روی مرز entity نه وسط کدپوینت)، و `sanitizeEntities()` (که الان در
`utils/messageSuffix.js` است و جای درستش همین‌جاست).

---

## ۵. لایه‌ی ① — کاربرد (`src/app`)

هر use-case یک تابع است، نه یک کلاس با ۱۰ متد:

```ts
export async function submitMuxJob(
  deps: Deps,
  input: { actor: Actor; chat: ChatRef; video: TelegramFile; subtitle: TelegramFile; mode: MediaMode }
): Promise<Result<{ jobId: string; statusMessageId: number }>>;
```

قواعد این لایه:

1. **فقط ports مصرف می‌کند** (`deps.jobs`, `deps.media`, `deps.clock`, …). هیچ `ctx` گرام‌مایی
   وارد نمی‌شود. هیچ SQL ای نوشته نمی‌شود.
2. **نتیجه‌ی خطا را برمی‌گرداند، throw نمی‌کند** برای خطاهای قابل‌انتظار (سهمیه، فرمت، دسترسی)؛
   فقط خطای غیرمنتظره throw می‌شود تا به `critical` برسد. این تفکیک، پیام فارسی درست به کاربر
   می‌دهد (کلاس‌های `UserFacingError`/`CriticalError` فعلی همین را می‌خواستند — درست بودند).
3. **کوتاه می‌ماند** (هدف: < ۸۰ خط). اگر بلند شد، یعنی بخشی از منطق باید به `core` برگردد.

`Deps` یک شیء تزریقی است که در `platform/composition.ts` یک‌بار در هر ایزوله ساخته می‌شود
(الگوی `handlerPromise` فعلی در `main-tel.ts` درست است؛ فقط تعمیم پیدا می‌کند).

---

## ۶. لایه‌ی ② — پورت‌ها (`src/ports`)

| پورت | مسئولیت | پیاده‌سازی‌ها |
|---|---|---|
| `Messenger` | ارسال/ویرایش پیام، دکمه، آپلود فایل، در هر سطح | `telegram`, (بعداً) `web-push` |
| `UserRepo` · `SpaceRepo` · `GameRepo` · `JobRepo` · `SettingsRepo` | دسترسی داده | `d1`, `in-memory` (تست) |
| `SessionStore` | حالت کوتاه‌مدت per-user («منتظر متن شما») | `do`, `memory` (تست) |
| `JobQueue` | claim/lease/heartbeat/progress/complete | `do`, `fake` |
| `MediaRunner` | اجرای نقشه‌ی مدیا روی یک runner | `node`, `container`, `client` |
| `BlobStore` | بایت‌ها | `r2`, `memory` |
| `RateLimiter` | سطل توکن | `do`, `kv`, `memory` |
| `AiProvider` | generate/structured/vision/embed | `gemini`, `workers-ai`, `fake` |
| `Clock` · `Logger` · `Ids` | زمان، لاگ، تولید ULID | عادی + `fixed` برای تست |

چند امضای کلیدی که بقیه‌ی طراحی روی آن‌ها می‌ایستد:

```ts
// ports/media-runner.ts — تبدیل «اجرا» به یک چیز قابل‌جای‌گزینی
export interface MediaRunner {
  readonly id: string;                                  // "node:fra-01" | "container:ffmpeg" | "client:miniapp"
  readonly capabilities: ReadonlySet<RunnerCapability>; // "ffmpeg" | "mkvmerge" | "stockfish" | "local-bot-files"
  readonly capacity: { slots: number; busy: number };
  submit(job: RunnerJob): Promise<Result<{ externalId: string }>>;
  cancel(externalId: string): Promise<Result<void>>;
}

// ports/messenger.ts — مستقل از تلگرام تا بتوان وب/CLI هم مصرفش کند
export interface Messenger {
  reply(ref: ChatRef, view: View, opts?: SendOpts): Promise<Result<MessageRef>>;
  edit(ref: MessageRef, view: View): Promise<Result<void>>;
  toast(ref: CallbackRef, text: string, alert?: boolean): Promise<void>;
}
export type View = { text: string; keyboard?: KeyboardSpec; media?: MediaRef; parse?: "HTML" };
```

نکته: `View` یک توصیف داده‌ای است، نه HTML رشته‌ای. آداپتور تلگرام آن را به HTML و
`InlineKeyboard` تبدیل می‌کند؛ یک وب‌فرانت همان `View` را به JSON می‌دهد. این تنها راه
رسیدن به هدف «روی هر وسیله‌ای قابل استفاده» بدون دوباره‌نویسی هر صفحه است.

---

## ۷. لایه‌ی ③ — آداپتورها (`src/adapters`)

### ۷.۱ تلگرام (`adapters/telegram`)

- مسیر وبهوک: `POST /telegram` بماند (سازگاری با تنظیم فعلی و `secret_token`).
- **اما**: پردازش را از پاسخ‌دهی جدا می‌کنیم: وبهوک فقط `update` را اعتبارسنجی و در
  صف (`Queue`) می‌گذارد و سریع `200` می‌دهد. مصرف‌کننده‌ی صف ۱۵ دقیقه فرصت دارد،
  پس دیگر «تایم‌اوت تلگرام» معنا ندارد. (جزئیات در ADR-۳.)
- **throttling و retry**: افزودن `@grammyjs/auto-retry` + `@grammyjs/transformer-throttler`.
  امروز هیچ‌کدام نیست؛ با رشد کاربر، خطای `429` و `retry_after` کار را می‌خواباند.
- **پیام‌های وضعیت**: یک helper `ProgressReporter` که ویرایش پیام را throttle می‌کند
  (حداکثر هر ۲.۵ ثانیه یا هر ۵٪ پیشرفت، هرکدام اول رسید) تا به flood limit تلگرام نخوریم.
- `renderScreen` فعلی الگوی خوبی است (ویرایش جای ارسال، و ignore کردن
  «message is not modified»). فقط به `Messenger.edit` منتقل می‌شود.

### ۷.۲ سطح اجرا — سه آداپتور رسانه (`adapters/media/*`)

| آداپتور | برای چه | مزیت | هزینه |
|---|---|---|---|
| `node` (VPS + Local Bot API Server) | فایل بزرگ، mkvmerge، هاردساب، Stockfish | بی‌سقف عملی (۲GB)، دیسک واقعی، GPU اختیاری | باید سرور را نگه دارید (بخش [`MEDIA-PLANE.md`](./MEDIA-PLANE.md)) |
| `container` (Cloudflare Containers) | همان کارها بدون سرور شخصی | همه‌چیز در Cloudflare | cold start چند ثانیه‌ای، بیلینگ جدا، وابستگی به محصول بتا |
| `client` (Mini App + WebCodecs) | فایل شخصی کاربر | هزینه‌ی سرور صفر، حریم خصوصی بیشتر | فقط با مرورگر مدرن، نیاز به آپلود نتیجه |

**نکته‌ی معماری مهم:** اگر نود را انتخاب کنید، *همان ماشین* باید Local Bot API Server را هم
داشته باشد، چون در حالت `--local` متد `getFile` مسیر مطلق روی دیسک برمی‌گرداند و فایل
بدون یک بایت دانلود در Worker مستقیم به ffmpeg می‌رود. این یعنی اضافه‌کردن یک capability به
runner: `local-bot-files`. زمان‌بند job ها این capability را ترجیح می‌دهد.

### ۷.۳ داده و بقیه

`d1/` (پیاده‌سازی repo ها)، `kv/` (فقط throttle و کش کوتاه)، `r2/` (artifacts و stage)،
`do/` (سه کلاس بخش ۱۰)، `ai/gemini/` (REST ساده — نیازی به SDK سنگین نیست)،
`http/` (API نسخه‌دار `v1` برای وب/CLI/Mini App).

---

## ۸. لایه‌ی ④ — پلاگین‌ها و رجیستری فیچر

این، تعمیم همان ایده‌ی خوبی است که الان در `FEATURES` آرایه‌ی `main-tel.ts` دارید — فقط
خودتوصیف و تایپ‌دار می‌شود:

```ts
// features/registry.ts
export interface FeatureModule {
  id: string;                                   // "media.mux"
  title: string;                                // «ادغام زیرنویس»
  capabilities: Capability[];                   // برای ساخت خودکار منو و بررسی دسترسی
  enabled?: (env: Env, flags: Flags) => boolean;
  commands?: CommandSpec[];                     // { name, description, handler }
  callbacks?: CallbackSpec[];                   // { pattern, handler }
  routes?: RouteSpec[];                         // برای API/وب
  menu?: (ctx: MenuCtx) => MenuItem[];          // ورودی منوی اصلی
  migrations?: string[];                        // فایل‌های SQL این فیچر
  crons?: CronSpec[];                           // { schedule, handler }
  workers?: Capability[];                       // به کدام runner نیاز دارد
}
```

`features/media/manifest.ts` نمونه:

```ts
export const mediaFeature: FeatureModule = {
  id: "media.mux",
  title: "ادغام زیرنویس با ویدیو",
  capabilities: ["media:mux"],
  commands: [{ name: "mux", description: "ادغام فایل زیرنویس با ویدیو", handler: onMuxCommand }],
  callbacks: [
    { pattern: /^mx:m:(\w+):([A-Z0-9]{26})$/, handler: onModeChoice },   // ULID = ۲۶ کاراکتر
  ],
  crons: [{ schedule: "*/5 * * * *", handler: reapStaleJobs }],
  workers: ["ffmpeg"],
  migrations: ["0010_jobs.sql", "0011_artifacts.sql"],
};
```

سودهای ملموس:
۱) منو از روی `capabilities` ساخته می‌شود → دکمه‌ی مرده‌ای که امروز در README به آن اشاره کرده‌اید
(«Admin Panel / Settings / Statistics / Help … هیچ واکنشی ندارند») دیگر **ساختاراً** ممکن نیست:
هر آیتم منو باید capability پشتی داشته باشد.
۲) محدودکردن یک فیچر به‌صورت آزمایشی = یک flag، بدون تغییر کد.
۳) فیچر جدید = یک پوشه + یک خط در `registry.ts`.

---

## ۹. سطح اجرا: پروتکل job

چون Worker هیچ‌وقت فرایند طولانی نگه نمی‌دارد، «کار» یک موجودیت درجه‌اول است، نه یک `await`.

### ۹.۱ چرخه‌ی حیات

```
 queued ──claim──▶ leased ──start──▶ running ──┬──▶ succeeded
    ▲                                          ├──▶ failed
    └────── lease expired / heartbeat lost ────┘
                                               └──▶ canceled
```

### ۹.۲ پروتکل (HMAC-امضاشده، بین Worker و نود)

| متد | مسیر | کار |
|---|---|---|
| `POST` | `/internal/v1/workers/heartbeat` | نود زنده است + ظرفیت خالی اعلام می‌کند |
| `POST` | `/internal/v1/jobs/claim` | claim اتمیک؛ پاسخ می‌تواند long-poll تا ۳۰ ثانیه بلاک شود |
| `POST` | `/internal/v1/jobs/:id/progress` | `{ percent, stage, note }` — throttle شده |
| `POST` | `/internal/v1/jobs/:id/complete` | `{ status, artifacts[], metrics, error }` |
| `POST` | `/internal/v1/jobs/:id/cancel` | لغو (از سمت کاربر) |

- **امضا:** `HMAC-SHA256(secret_node, timestamp + "." + nonce + "." + sha256(body))` با
  پنجره‌ی ±۳۰۰ ثانیه و کش nonce (جلوگیری از replay). با `crypto.subtle` در Worker.
- **claim اتمیک** در یک DO انجام می‌شود، نه با `UPDATE ... LIMIT 1` (که در D1 مسابقه‌پذیر است).
- **lease** = `lease_expires_at` + heartbeat؛ اگر نود بمیرد، job خودکار به `queued` برمی‌گردد.
- **idempotency**: هر job کلید یکتا (ULID) دارد؛ `complete` دوباره‌ی همان job بی‌اثر است.

### ۹.۳ چرا long-poll و نه push؟

نود پشت فایروال است؛ push یعنی باید نود را روی اینترنت باز کنید (سطح حمله بیشتر).
long-poll با یک اتصال پایدارِ ساده، هم تأخیر را پایین می‌آورد (job جدید در <۱ ثانیه claim می‌شود)
هم لازم نیست در نود سرور HTTP عمومی بالا بیاورید.

### ۹.۴ Queues & Workflows

- **Queues**: برای fan-out (اعلان به مدیران، ثبت audit، مهرزمانی)، و برای جداسازی وبهوک از پردازش.
- **Workflows** (اختیاری، فاز ۴+): برای خط لوله‌ی چندمرحله‌ای مدیا
  (`probe → plan → run → deliver → cleanup`) که هر گام مدت انتظار نامحدود و retry مستقل دارد.
  این دقیقاً همان چیزی است که در Worker ساده نمی‌شود نوشت، و در Cloudflare به‌صورت مدیریت‌شده هست.

---

## ۱۰. مدل داده

### ۱۰.۱ D1 — رکورد سیستمی

جداول موجود (`users`, `user_logs`, `bot_settings`, `channels`, `channel_admins`) حفظ می‌شوند و
این‌ها اضافه می‌شوند (SQL نمونه؛ در مهاجرت‌های شماره‌دار):

```sql
-- ── فضاها: تعمیم «کانال» به هر جای تلگرام (کانال، گروه، سوپرگروه فرومی) ─────────
ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'channel';  -- channel|group|forum
ALTER TABLE channels ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
-- (نام‌گذاری هدف: spaces / space_admins؛ تغییر نام در یک مهاجرت جدا انجام می‌شود)

-- ── تنظیمات per-space به‌جای ستون‌های بی‌شمار ─────────────────────────────────
CREATE TABLE IF NOT EXISTS space_settings (
  space_id   INTEGER NOT NULL,
  key        TEXT    NOT NULL,          -- 'suffix.text' | 'suffix.skip_marker' | 'mod.antilink' | ...
  value      TEXT,
  updated_by INTEGER,
  updated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (space_id, key)
);
-- مهاجرت داده: official_suffix → 'suffix.text' ، suffix_skip_marker → 'suffix.skip_marker'

-- ── کارها (قلب فیچرهای سنگین) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                TEXT PRIMARY KEY,            -- ULID
  kind              TEXT NOT NULL,               -- media.mux|media.burn|media.probe|chess.engine|ai.summarize
  status            TEXT NOT NULL,               -- queued|leased|running|succeeded|failed|canceled|expired
  priority          INTEGER NOT NULL DEFAULT 0,
  requester_id      INTEGER NOT NULL,
  origin_chat_id    INTEGER,
  origin_message_id INTEGER,
  status_message_id INTEGER,                     -- پیامی که پیشرفت را در آن ویرایش می‌کنیم
  payload           TEXT NOT NULL,               -- JSON (مثلاً MuxPlan)
  plan_version      INTEGER NOT NULL DEFAULT 1,
  progress          INTEGER NOT NULL DEFAULT 0,
  stage             TEXT,
  attempt           INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  lease_owner       TEXT,
  lease_expires_at  TEXT,
  idempotency_key   TEXT,
  api_host          TEXT NOT NULL DEFAULT 'cloud',-- cloud|local → چون file_id بین دو سرور معتبر نیست
  error_code        TEXT,
  error_message     TEXT,
  created_at        TEXT DEFAULT (CURRENT_TIMESTAMP),
  started_at        TEXT,
  finished_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim   ON jobs(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_user    ON jobs(requester_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idem ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── artifacts: خروجی کارها کجا رفت ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL,
  kind        TEXT NOT NULL,        -- video|subtitle|thumbnail|report
  r2_key      TEXT,                 -- اگر در R2 است
  size_bytes  INTEGER,
  sha256      TEXT,
  tg_file_id  TEXT,                 -- ✅ به‌همراه api_host: file_id بین سرورها جابه‌جا نمی‌شود
  api_host    TEXT,
  expires_at  TEXT,
  created_at  TEXT DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- ── رخدادها: ردِ پای قابل‌خواندن برای پشتیبانی ───────────────────────────────
CREATE TABLE IF NOT EXISTS job_events (
  job_id     TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  level      TEXT NOT NULL,          -- info|warn|error
  message    TEXT NOT NULL,
  data       TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (job_id, seq)
);

-- ── نشست‌های آپلود بزرگ (مسیر جایگزین وقتی سرور محلی نداریم) ─────────────────
CREATE TABLE IF NOT EXISTS upload_sessions (
  id            TEXT PRIMARY KEY,
  requester_id  INTEGER NOT NULL,
  kind          TEXT NOT NULL,       -- video|subtitle
  expected_size INTEGER,
  actual_size   INTEGER,
  r2_key        TEXT,
  status        TEXT NOT NULL,       -- pending|uploading|complete|expired
  expires_at    TEXT NOT NULL,
  created_at    TEXT DEFAULT (CURRENT_TIMESTAMP)
);

-- ── شطرنج: آرشیو ماندگار (حالت زنده در DO) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS chess_games (
  id            TEXT PRIMARY KEY,    -- ULID = همان نام DO
  chat_id       INTEGER NOT NULL,
  white_id      INTEGER NOT NULL,
  black_id      INTEGER NOT NULL,    -- می‌تواند id بات باشد (بازی با موتور)
  mode          TEXT NOT NULL,       -- pvp|pve|eve|simulation
  status        TEXT NOT NULL,       -- active|finished|aborted
  result        TEXT,                -- 1-0|0-1|1/2-1/2|*
  reason        TEXT,                -- checkmate|stalemate|resign|timeout|draw_agreement|fifty_move|repetition
  initial_fen   TEXT NOT NULL DEFAULT 'startpos',
  final_fen     TEXT,
  time_control  TEXT,                -- {'base':300,'inc':2}
  ply_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (CURRENT_TIMESTAMP),
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_chess_chat ON chess_games(chat_id, status);

CREATE TABLE IF NOT EXISTS chess_moves (
  game_id   TEXT NOT NULL,
  ply       INTEGER NOT NULL,
  san       TEXT NOT NULL,
  uci       TEXT NOT NULL,
  fen_after TEXT NOT NULL,
  clock_ms  INTEGER,
  by_id     INTEGER,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (game_id, ply)
);

-- ── پرچم‌ها، سهمیه، ریتینگ، audit ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
                                          rollout INTEGER NOT NULL DEFAULT 100, updated_at TEXT);
CREATE TABLE IF NOT EXISTS user_flags    (user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT,
                                          PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS quotas        (user_id INTEGER NOT NULL, bucket TEXT NOT NULL,
                                          window_start TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
                                          PRIMARY KEY (user_id, bucket, window_start));
CREATE TABLE IF NOT EXISTS ratings       (user_id INTEGER PRIMARY KEY, rating INTEGER NOT NULL DEFAULT 1200,
                                          games INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
CREATE TABLE IF NOT EXISTS audit_log     (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER,
                                          action TEXT NOT NULL, target TEXT, meta TEXT,
                                          created_at TEXT DEFAULT (CURRENT_TIMESTAMP));
```

> **چرا `space_settings` جای ستون؟** امروز `channels` دو ستون از جنس «تنظیمات فیچر» دارد
> (`official_suffix`, `suffix_skip_marker`). با سه فیچر بعدی (فیلتر لینک، خوش‌آمد، ارسال زمان‌بندی‌شده)
> این جدول به ۱۵ ستون می‌رسد که هر کدام برای یک فیچر است. مدل key/value عوارض ندارد و
> افزودن فیچر جدید migration نمی‌خواهد.

### ۱۰.۲ Durable Objects — حالت زنده و هماهنگی

| کلاس | نام‌گذاری | مسئولیت | چرا DO |
|---|---|---|---|
| `SessionDO` | `user:<id>` | «منتظر متن شما»، آخرین صفحه، وضعیت گفت‌وگو، شمارنده‌ی نرخ per-user | تک‌نویسنده، بدون مسابقه، جایگزین درست `pendingInput` و `conversations()` |
| `GameDO` | `game:<ulid>` | تخته، نوبت، ساعت، پیشنهاد تساوی، آرشیو حرکت‌ها، alarm برای اتمام وقت | ترتیب تضمین‌شده‌ی حرکت‌ها + آلارم تایمر (Cron دقت ثانیه ندارد) |
| `JobQueueDO` | `jobs:default` / `jobs:shard-N` | lease اتمیک، heartbeat، تایم‌اوت، شمارش همزمانی per-user | claim بدون مسابقه؛ تنها منبع حقیقت برای «چه کسی چه کاری گرفته» |
| `DedupeDO` | `chat:<id>` | جلوگیری از پردازش دوباره‌ی `update_id` | یکتایی قطعی (KV در نهایت‌سازگار است و اجازه‌ی عبور تکراری می‌دهد) |

نمونه‌ی الگوی آلارم برای شطرنج:

```
move played → GameDO: ذخیره‌ی حرکت، محاسبه‌ی نوبت بعد، setAlarm(deadline)
        │
        └─ اگر تا deadline حرکتی نرسید → alarm → اعلام باخت به‌خاطر وقت + پایان بازی
```
این بدون DO یعنی یک Cron هر دقیقه که با تأخیر و هزینه کار را انجام می‌دهد.

### ۱۰.۳ KV / R2 / Queues / Analytics

- **KV**: فقط throttle گزارش خطا (کاربرد فعلی، درست) + کش پاسخ AI با کلید هش.
- **R2**: `shadow-media` (فایل مرحله‌ای و artifacts، با lifecycle rule حذف بعد از N روز)،
  `shadow-backups` (خروجی `d1 export`). خروجی R2 هزینه‌ی ترافیک ندارد → برای «لینک دانلود برای
  فایل‌های بالای ۲۰MB» بهترین گزینه است.
- **Queues**: `shadow-updates` (update ها)، `shadow-events` (اعلان/audit)، `shadow-dlq`.
- **Analytics Engine** (اختیاری ولی ارزان و بسیار مفید): نوشتن یک data point برای هر
  رویداد مهم (`job.completed{kind,status,durationMs}`، `update.received{type}`، `error{context}`)
  تا داشبورد و هشدار داشته باشید، بدون جدول شمارش در D1.

### ۱۰.۴ سیاست نگهداشت

| داده | عمر | مکانیزم |
|---|---|---|
| فایل مرحله‌ای مدیا (R2) | ۲۴ ساعت | lifecycle rule |
| artifact تحویل‌شده | ۷ روز | lifecycle rule + `expires_at` |
| `job_events` | ۹۰ روز | کرون پاکسازی بچ‌بچ |
| `job` تمام‌شده | ۹۰ روز | همان |
| بازی شطرنج تمام‌شده | دائمی (کوچک است و ارزش آرشیوی دارد) | — |
| `update_id` dedupe | ۱۰ دقیقه | TTL در DO |
| `upload_sessions` منقضی | ۱ ساعت | کرون + بررسی هنگام مصرف |

---

## ۱۱. فیچر شطرنج — طراحی تفصیلی

### ۱۱.۱ چهار حالت بازی

| حالت | توصیف | نکته‌ی معماری |
|---|---|---|
| `pvp` | دو کاربر در یک چت/گروه، بات داور است | ذخیره‌ی `white_id/black_id`، اعتبارسنجی نوبت از روی `from.id` |
| `pve` | کاربر با موتور بات | موتور در Worker (سریع، ضعیف) یا روی نود (قوی) — یک capability |
| `eve` | دو موتور با هم (نمایشی) | اجرا در DO با آلارم کوچک بین حرکت‌ها تا از سقف CPU فرار کند |
| `simulation` | شبیه‌سازی آفلاین با **seed** ثابت، خروجی PGN | اجرای دسته‌ای؛ همان هسته، بدون UI؛ برای تست و برای گزارش |

### ۱۱.۲ رندر تخته: چرا متن، نه تصویر

تخته با `<pre>` و کاراکترهای یونیکد شطرنج (`♔♕♖♗♘♙♚♛♜♝♞♟`) رندر می‌شود:
هزینه‌ی CPU تقریباً صفر، در هر کلاینتی درست دیده می‌شود، و کاراکترهای دکمه‌ها
(`a1`…`h8`، «قلعه کوچک»، «تساوی») از `InlineKeyboard` می‌آیند.

اگر بعداً تصویر خواستید، دو راه سازگار با معماری: (الف) رندر SVG و تبدیل با `resvg-wasm`
(چند مگابایت به باندل اضافه می‌کند ولی در سقف ۶۴MiB جا می‌شود)، (ب) ارسال FEN به نود و
رندر با ImageMagick — یعنی دوباره همان پورت `MediaRunner`. تصمیم فاز ۲: **متن**.

### ۱۱.۳ تعامل

```
هر حرکت: یا با دکمه‌ی مربعِ مبدأ/مقصد، یا با تایپ SAN/UCI ("Nf3", "e2e4", "O-O")
نمایش: تخته + نوبت + ساعت + آخرین حرکت + دکمه‌ها [لغو][تساوی][واگذاری][تاریخچه][خروجی PGN]
```
`callback_data` باید ≤۶۴ بایت بماند → الگوی `ch:<gameUlid[8]>:mv:<ply>:<sq-from><sq-to>`
یا حتی بهتر: چون تخته در DO است، فقط `ch:<ulid>:<uci>` لازم است و می‌توان ULID را در
پیام (نه در دکمه) نگه داشت. این محدودیت را باید از اول در طراحی دکمه‌ها دید.

---

## ۱۲. فیچر مدیریت کانال و چت (`space`)

مدل ذهنی جدید: هر جای تلگرام که بات در آن اختیار دارد = یک **Space** با `kind ∈ {channel, group, forum}`
و مجموعه‌ای از **قابلیت‌ها**. آنچه امروز داریم و منتقل می‌شود:

| امروز | مقصد |
|---|---|
| `features/channels.js` (ثبت با فوروارد + بررسی مالکیت) | `features/space/register.ts` + `app/space/registerSpace` |
| `channelSuffix.js` + `messageSuffix.js` | `features/suffix/` + `core/space/suffix.ts` (منطق خالص) |
| `channelAdminSync.js` | `app/space/syncAdmins` + cron router |
| ستون‌های suffix در جدول `channels` | `space_settings` |

قابلیت‌های بعدی (هرکدام یک manifest مستقل):

- **فیلتر و مدیریت محتوا**: حذف خودکار لینک/کلمه، محدودیت عضو جدید، ضدفلود (نیازمند
  `restrictChatMember`). ⚠️ نکته‌ی عملیاتی: بات فقط پیام‌های گروه را می‌بیند که
  Group Privacy در BotFather خاموش باشد؛ این باید در UI مستند و چک شود.
- **زمان‌بندی پست**: صف `scheduled_posts` + کرون هر دقیقه + انتخاب موضوع (`message_thread_id`)
  — الگوی `threadId` که در `telegramService.js` دارید، اینجا حیاتی می‌شود.
- **آرشیو و بازنشر**: ذخیره‌ی پست‌ها در R2 و بازنشر با پسوند/ترجمه‌ی AI (اتصال به `AiProvider`).
- **آمار رشد**: snapshot روزانه در جدول کوچک (این مورد دقیقاً در TODO شما هست: «ذخیره‌ی آمار هر اجرای پاکسازی»).

**هر کدام از این‌ها از هم جدا هستند** چون هر کدام manifest خودش را دارد و می‌توان
با یک flag خاموشش کرد. این بهترین پاسخ به «می‌خواهم همه‌کاره باشد ولی نشکند» است.

---

## ۱۳. چند‌سطحی بودن: «روی هر وسیله‌ای قابل استفاده»

سه سطح، یک هسته:

| سطح | مسیر | احراز هویت | یادداشت |
|---|---|---|---|
| **تلگرام** (الان) | وبهوک | `secret_token` تلگرام + نقش کاربر | تمرکز فعلی |
| **HTTP API v1** | `/api/v1/*` | توکن نشست یا `initData` | برای وب، CLI، یکپارچه‌سازی |
| **Mini App** | همان API از داخل تلگرام | اعتبارسنجی `initData` با HMAC-SHA256 (`WebAppData` به‌عنوان کلید) | برای آپلود فایل و اجرای مدیا سمت کلاینت |

قاعده: **هیچ use-case ای نمی‌داند درخواست از کجا آمده.** `Messenger` و `ChatRef` این را پنهان می‌کنند.
پس افزودن سطح وب یعنی نوشتن یک آداپتور، نه بازنویسی فیچرها.

---

## ۱۴. امنیت

| تهدید | کنترل |
|---|---|
| update جعلی | `secret_token` (داریم) + dedupe `update_id` (نداریم) |
| replay روی API داخلی نود | HMAC با timestamp+nonce، پنجره‌ی ±۳۰۰s، کش nonce |
| abuse سهمیه | سقف job همزمان per-user (DO)، سهمیه‌ی روزانه، محدودیت اندازه‌ی فایل |
| دکمه‌ی callback با شناسه‌ی دیگران | **هر** callback باید مالکیت را از DO/DB چک کند، نه از روی محتوای دکمه (الگوی `requireChannelAdmin` فعلی درست است — تعمیم بده) |
| آپلود مخرب فایل | سقف اندازه از روی `expected_size`، probe با ffprobe، timeout اجرا، اجرا در محیط محدود (`--no-network`)، نام‌گذاری امن فایل |
| نشت توکن | توکن فقط در Worker و روی نود؛ هرگز در URL قابل‌اشتراک (`api.telegram.org/file/bot<TOKEN>/...` را به کاربر ندهید) |
| XSS در وب | CSP موجود خوب است؛ فقط `img-src` را اگر R2 اضافه شد به‌روز کنید |
| دسترسی بی‌جا در پنل | capability ها + `audit_log` برای هر عملیات مدیر |

---

## ۱۵. مشاهده‌پذیری و عملیات

- **زمینه‌ی درخواست** (`platform/context.ts`): `AsyncLocalStorage` (همان الگوی `executionCtxStorage`
  فعلی) برای `traceId`, `updateId`, `userId`, `jobId`. هر خط لاگ JSON شامل این‌ها.
- **لاگ**: فعلاً `console.log` پراکنده؛ تبدیل به `logger.info("job.completed", {jobId, ms})`
  تا در Workers Logs قابل فیلتر و شمارش باشد.
- **`GET /health`**: بررسی D1، KV، DO، آخرین heartbeat نودها، طول صف. (در TODO شما هست — اینجا تعریف دقیقش.)
- **`GET /metrics`** داخلی (HMAC): شمارش job ها، نرخ خطا، عمق صف.
- **هشدار**: پاکسازی خودکار باید آمار اجرا را در جدول بنویسد (TODO شما) + اعلان به گپ لاگ (داریم).
- **بودجه‌ی باندل**: `wrangler deploy --dry-run --outdir bundle` و بررسی اندازه در CI.
  امروز باندل کوچک است؛ با اضافه‌کردن `resvg-wasm` یا SDK های سنگین، ممکن است به سقف ۶۴MiB نزدیک شویم.

---

## ۱۶. تست و CI

| لایه | ابزار | چه چیزی را تضمین می‌کند | سرعت |
|---|---|---|---|
| ⓪ هسته | vitest، بدون runtime ورکرز | perft، پارس SRT، `renderArgv`، قواعد دسترسی | میلی‌ثانیه |
| ① کاربرد | fakes برای همه‌ی پورت‌ها | رفتار use-case بدون شبکه/DB | صدم ثانیه |
| ② آداپتور | vitest-pool-workers + D1 واقعی | SQL، مهاجرت‌ها، تراکنش‌ها (الان دارید — عالی) | ثانیه |
| ③ قرارداد | اجرای واقعی یک نود شبیه‌سازی‌شده | پروتکل job، امضا، lease، timeout | دقیقه (در CI شبانه) |

- **آزمون‌های طلایی (golden)**: `argv` تولیدی از `MuxPlan` به‌صورت snapshot ذخیره شود؛ هر تغییری
  در دستور ffmpeg باید در دیف PR دیده شود. این جلوی «یک روز ffmpeg خطا می‌دهد و کسی نمی‌داند چرا» را می‌گیرد.
- **فیچر‌فایل‌های واقعی زیرنویس** در `test/fixtures/subtitles/` با فایل‌های خرابِ واقعی.
- **CI**: `typecheck` + `vitest run` + `wrangler deploy --dry-run` (هم برای اندازه، هم برای اطمینان از بایندینگ‌ها)
  + `prettier --check`. (این مورد هم در TODO شما هست.)

---

## ۱۷. بدهی فنی موجود که باید در مسیر رفع شود

این‌ها یافته‌های واقعی از همین کدبیس‌اند، به‌ترتیب اهمیت:

| # | مشکل | جا | اثر واقعی | راه‌حل |
|---|---|---|---|---|
| ۱ | `pendingInput` یک `Map` درون‌ایزوله است | `ui/pendingInput.js` | کاربر «منتظر متن» را بین درخواست‌ها از دست می‌دهد (چند ایزوله همزمان) | `SessionDO` (پورت `SessionStore`) |
| ۲ | `conversations()` ثبت شده ولی **هیچ گفت‌وگویی** وجود ندارد | `bot.ts` | وابستگی مرده + اگر روزی استفاده شود، با storage درون‌حافظه در وبهوک می‌شکند | حذف، یا اتصال با storage روی DO |
| ۳ | بدون dedupe روی `update_id` | `main-tel.ts` | تلگرام وبهوک را retry می‌کند → ثبت دوباره‌ی کانال، پسوند دوباره، پیام تکراری | `DedupeDO` یا جدول dedupe |
| ۴ | بدون throttle و auto-retry | `bot.ts` | با رشد کاربر، `429` و `retry_after` پیام‌ها را می‌اندازد | `@grammyjs/auto-retry` + `transformer-throttler` |
| ۵ | مدیریت کرون با مقایسه‌ی رشته‌ی `event.cron` و «همه‌ی بقیه → cleanup» | `index.ts` | افزودن کرون سوم، بی‌صدا cleanup را دوباره اجرا می‌کند | `platform/cron-router.ts` با نگاشت صریح و default = log منفی |
| ۶ | `schema.sql` دستی اجرا می‌شود | `db/schema.sql` | تغییر اسکیما در پروداکشن ردیابی‌شدنی نیست | `wrangler d1 migrations` + مهاجرت هر فیچر در manifest |
| ۷ | `escapeHtml` سه بار کپی شده | ۳ فایل | یکسان‌سازی نشدن رفتار و باگ‌های ظریف | انتقال به `core/text` |
| ۸ | ستون‌های تنظیمات فیچر روی جدول `channels` | `schema.sql` | با فیچر سوم، جدول پر از ستون‌های تک‌کاربردی می‌شود | `space_settings` |
| ۹ | `strict: false` و ترکیب JS/TS بی‌نوع | `tsconfig.json` | نبود محافظ در برابر خطای رایج | `src/core` با `strict: true`، مهاجرت تدریجی |
| ۱۰ | نبود rate limit روی ثبت کانال | README هم گفته | یک نفر با فوروارد زیاد، `getChatMember` را می‌سوزاند | `RateLimiter` (DO) روی capability `space:manage` |
| ۱۱ | دکمه‌هایی که کار نمی‌کنند | README | کاربر فکر می‌کند بات خراب است | منو از روی `manifest` ساخته شود → مرده‌دکمه ناممکن |
| ۱۲ | نبود `.dev.vars.example` و  `/health` | README | راه‌اندازی برای نفر بعد کند است؛ مانیتورینگ نداریم | بخش ۱۵ همین سند + قدم ۰.۲ در ROADMAP |

---

## ۱۸. تصمیم‌های معماری (خلاصه‌ی ADR)

| # | تصمیم | دلیل اصلی | بدیل رد‌شده چون | هزینه‌ی برگشت |
|---|---|---|---|---|
| ADR-۱ | معماری لایه‌ای با هسته‌ی خالص (hexagonal سبک) | تست‌پذیری، جداشدن فیچرها از تلگرام | «همین‌طور ادامه بده» → با فیچر سوم به دیوار می‌خورد | متوسط (مکانیکی) |
| ADR-۲ | سطح اجرا پشت پورت `MediaRunner` با ۳ پیاده‌سازی | ffmpeg در Worker ناممکن است؛ و شما «هر سه» را می‌خواستید | انتخاب سخت‌کد یکی از سه گزینه | پایین ✅ |
| ADR-۳ | پردازش وبهوک از پاسخ‌دهی جدا (Queue) | محدودیت زمانی تلگرام + پردازش دوباره‌ی retry | پردازش درون‌خطی (وضع فعلی) | پایین |
| ADR-۴ | حالت زنده در Durable Objects، نه KV/D1 | تک‌نویسنده، آلارم، بدون مسابقه | D1 + Cron (تأخیر و مسابقه) | متوسط |
| ADR-۵ | «نقشه» جدا از «اجرا» در فیچر مدیا | تست‌پذیری + جابه‌جایی آزاد ابزار | نوشتن دستور ffmpeg در هندلر | پایین ✅ |
| ADR-۶ | تنظیمات per-space به‌شکل key/value | افزودن فیچر بدون migration | ستون‌های جدید برای هر تنظیم | پایین |
| ADR-۷ | یک Worker واحد بماند (فعلاً) | یک دیپلوی، اشتراک کد، باندل کوچک | تقسیم به چند Worker (پیچیدگی بی‌مورد) | بالا (ولی بعداً ممکن) |
| ADR-۸ | Local Bot API Server روی همان نود مدیا | فایل بدون عبور از Worker به ffmpeg می‌رسد | R2 به‌عنوان واسط (دانلود+آپلود دوباره) | پایین |
| ADR-۹ | رندر تخته‌ی شطرنج متنی، نه تصویری | صفر CPU، بدون وابستگی، سازگاری همه‌جانبه | wasm رستر + باندل سنگین‌تر | پایین ✅ |
| ADR-۱۰ | منو/Capability از روی manifest | حذف «دکمه‌ی مرده» به‌صورت ساختاری | دستی نگه‌داشتن منو | پایین ✅ |

---

## ۱۹. سنجه‌های ظرفیت (برآورد سریع)

سناریوی مرجع: ۵٬۰۰۰ کاربر فعال، ۵۰۰ کانال ثبت‌شده، ۲۰ job مدیا در روز.

| منبع | مصرف تخمینی | سقف | وضعیت |
|---|---|---|---|
| درخواست Worker (update ها) | ~۱۵۰K/روز | ۱۰۰K/روز رایگان، بقیه پرداختی | پلن پرداختی لازم است |
| CPU Worker | چند ms به‌ازای هر update (بدون مدیا/شطرنج سنگین) | ۳۰s پیش‌فرض | راحت ✅ |
| D1 | `jobs` + `job_events` ~۲۰۰K ردیف/سال | ~۱۰GB per DB | راحت ✅ (با پاکسازی ۹۰ روزه) |
| DO requests | هر حرکت شطرنج + هر claim job | بیلینگ per-request | راحت ✅ |
| R2 | فایل مرحله‌ای ۲۴ ساعته: ۲۰ × ۵۰۰MB = ۱۰GB چرخشی | نامحدود عملاً | هزینه‌ی ناچیز، ترافیک خروج رایگان |
| نود مدیا (۲ vCPU، ۴GB RAM، ۸۰GB SSD) | mkvmerge: ۱۰–۲۰s per ۱۰۰MB؛ هاردساب: ۰.۳–۱× زمان واقعی | — | برای ۲۰ job/روز کافی؛ برای ۱۰۰+ job/روز GPU (NVENC) را در نظر بگیرید |

عدد مهم برای UX: **هاردساب یک ویدیوی ۹۰ دقیقه‌ای می‌تواند تا یک ساعت طول بکشد.** پس «job» و
«پیشرفت» و «اعلان پایان» اختیاری نیستند؛ خودِ معماری باید این را پیش‌بینی کند، نه اینکه کاربر
منتظر بماند و فکر کند بات هنگ کرده.

---

## ۲۰. نقشه‌ی راه

در سند جدا: [`ROADMAP.md`](./ROADMAP.md) — فاز به فاز، هر فاز به قدم‌های PR-اندازه با
معیار پذیرش مشخص.

خلاصه‌ی ترتیب (عمداً از «کم‌ریسک و خالص» به «پرمخاطره و زیرساختی»):

```
فاز ۰  ایمنی و بهداشت      (CI، /health، dedupe، throttle، مهاجرت‌ها)
فاز ۱  اسکلت معماری        (core/ports/adapters/features + registry)
فاز ۲  شطرنج               (خالص + DO) ← بردِ سریع، ریسک زیرساختی صفر
فاز ۳  مغز زیرنویس         (پارس + MuxPlan) ← آماده‌سازی بی‌ریسک برای مدیا
فاز ۴  سطح اجرا            (نود + Local Bot API + پروتکل job)
فاز ۵  گسترش مدیریت فضا    (چت/گروه/فروم، مدیریت محتوا، زمان‌بندی، آمار)
فاز ۶  لایه‌ی AI و سطوح دیگر (Gemini، HTTP API، Mini App)
```

دلیل این ترتیب: فازهای ۲ و ۳ **هیچ ریسک زیرساختی** ندارند و کاملاً تست‌پذیرند؛ فاز ۴ که
سخت‌ترین بخش است، پس از آن می‌آید که هسته و قراردادها تثبیت شده‌اند.

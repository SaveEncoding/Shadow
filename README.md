# Shadow

Telegram bot + website , on Cloudflare Workers.

## What is this project?

Shadow is a single Cloudflare Worker that does two things at once:

1. **Telegram bot** (route `POST /telegram`) — with [grammY](https://grammy.dev), currently focused on managing users' Telegram channels.

2. **website** (rest of the routes) — a static site with a heaven/hell theme (gold and white on top, crimson and purple on the bottom), Persian and right-to-left.

Both parts are served from a single Worker and rely on **D1** (SQLite) and **KV** as database/temporary storage.

## Stack

- **Runtime:** Cloudflare Workers (migrating to TypeScript, part JS, part TS)
- **Telegram Bot:** [grammY](https://grammy.dev) + `@grammyjs/conversations` plugin
- **Database:** Cloudflare D1
- **Caching:** Cloudflare KV (throttling error reporting)
- **Test:** Vitest + `@cloudflare/vitest-pool-workers` — some tests run with mocks, some run directly on real D1 (test version)

## Setup

```bash
npm install

# Execute database schema — all statements have IF NOT EXISTS, so it's safe on
# already deployed databases
npx wrangler d1 execute <database_name> --remote --file=./src/telegram/db/schema.sql

# Set secrets
npx wrangler secret put TELEGRAM_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

npx wrangler deploy
```

After deploy, register the Telegram webhook with the same secret:

```
https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook?url=https://<your-worker-domain>/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

## Test

```bash
npm test
```

---

## 📋 TODO

### Website
- [x] Completely removing dependency on `env.ASSETS` — everything directly from the code Worker (bundled files) is served
- [x] 301 redirect from `.html` addresses to canonical version (while preserving query string)
- [x] `robots.txt`
- [x] Basic security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- [x] Correct behavior for `HEAD` and returning 405 for unauthorized methods
- [ ] Create a search menu

### Telegram bot
- [x] Removing dead and unused code (old and incompatible version of channel management, wrong imports with upper/lower case)
- [x] Webhook Secret validation (prevents processing of fake updates that do not come from Telegram)
- [x] Global error handling system (`withErrorHandling`, throttling error reporting with KV, `UserFacingError`/`CriticalError` classes)
- [x] Fix "body already used" bug in webhook error reporting path (clone `request` before it is consumed by handler)
- [x] Cache bot instance at the level isolate, instead of building from scratch on every request
- [x] `FEATURES` structure in `main-tel.js` to add new features without cluttering the main file
- [x] Main menu with inline buttons (`homeInlineKeyboard`)
- [x] Automatic registration of users who interact directly with the bot (private chat, command or reply to the bot in the group) in D1
- [x] Automatic cleaning of inactive users (more than 30 days without interaction), except VIP users — with daily Cron Trigger + notification to admins
- [x] **Add channel** feature: forward a post from the channel → verify admin/ownership User on the same channel (`getChatMember`) → Register in D1
- [x] Detailed and separate error messages for each case (channel not recognized / bot not yet admin of the channel / user not admin)
- [x] Bug fix: auto-forwarded posts from a channel to its connected chat group are no longer mistakenly considered as attempts to register the channel (this feature is only enabled in private chat with the bot)
- [x] "My channels" feature
- [x] Vitest test suite, including real tests on D1 (not mock) for the logic of the user and channel database
- [x] Regression coverage for the body-already-used bug, channel forwarding detection, and user "direct interaction" definition
- [ ] Use Gemini
- [ ] Connect the rest Menu buttons: "Admin Panel", "Settings", "Statistics", "Help" — now nothing happens if the user clicks them (no response, not even the loading state of Telegram closes) because none of them have a callback handler
- [ ] UI for managing registered channels from within "My Channels" (now just a raw text list; no delete channel button)
- [ ] A way (admin command or button) to make users VIP — now `UserService.setAsVip` can only be called from code and has no UI
- [ ] Store statistics from each purge run (number of users removed over time) in a small table, instead of just logging, so it can be tracked
- [ ] Rate limit on the ability to add channels, so that someone can't overload the forwards with too many requests Increase `getChatMember`

### Infrastructure
- [x] Partial migration to TypeScript (`index.ts`, `types.ts`, `assets.d.ts`)
- [x] Committing essential files that were previously mistakenly gitignored (`package.json`, `tsconfig.json`, `wrangler.jsonc`, `package-lock.json`, `vitest.config.js`, `test/`)
- [ ] Setting up GitHub Actions to automatically run tests on every push/PR
- [ ] Migrate to `wrangler d1 migrations` instead of manually running `schema.sql` on remote database (safer and more trackable for future schema changes)
- [ ] Complete TypeScript migration for remaining `.js` files
- [ ] A health-check endpoint (e.g. `GET /health`) that returns the connection status to D1/KV — for monitoring and uptime checks
- [ ] A `.dev.vars.example` file that documents all the secrets/environment variables needed by the project (without the actual values), for faster setup by anyone who is just cloning the project
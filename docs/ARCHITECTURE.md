# Shadow — General Assistant Architecture

> Shadow is **not** a Telegram-only bot. It is a general-purpose assistant platform whose
> first (and currently most complete) transport is Telegram. The architecture below keeps
> the core assistant logic transport-agnostic so the same features can later be exposed
> through a web app, REST API, Discord, or any other client.

## 1. High-level layers

```
┌─────────────────────────────────────────────────────────────┐
│  Transport / Adapter layer                                  │
│  Telegram (grammY) · Web (Workers) · future: Discord, API   │
├─────────────────────────────────────────────────────────────┤
│  Application / Feature layer                                │
│  Feature registry: channels, chess, media, assistant, users  │
├─────────────────────────────────────────────────────────────┤
│  Domain services                                            │
│  UserService · ChannelService · ChessService · MediaService  │
│  AssistantService (AI) · SettingsService                    │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure                                             │
│  D1 (relational) · KV (cache/throttle) · R2 (files)         │
│  Queues (async jobs) · Durable Objects (stateful sessions)  │
│  Workers AI / Gemini (LLM) · external ffmpeg service        │
└─────────────────────────────────────────────────────────────┘
```

Cross-cutting concerns (auth/roles, i18n, error reporting, rate limiting, logging) live in
`src/core/` and are injected into every feature.

## 2. Directory layout (target)

```
src/
  core/                  # transport-agnostic core
    registry.ts          # feature registration contract
    errors.ts            # UserFacingError / CriticalError
    i18n.ts              # Persian/English strings
    rateLimit.ts
  services/              # domain services (shared by all transports)
    userService.ts
    channelService.ts
    chessService.ts
    mediaService.ts
    assistantService.ts
  transports/
    telegram/            # grammY bot, middleware, keyboards
    web/                 # website + JSON API
  features/              # feature modules, each: (ctx, env) => void
    channels/
    chess/
    media/               # SRT + video merge
    assistant/           # AI chat
  infra/
    d1/, kv/, r2/, queues/, durableObjects/
```

The current `src/telegram/*` code maps to `transports/telegram/*` + `features/*`; migration
is incremental (see §6).

## 3. Feature contract

Every feature implements a single interface:

```ts
interface Feature {
  name: string;
  register(bot: Bot, env: Env, ctx?: ExecutionContext): void | Promise<void>;
}
```

Features are listed in one array (`FEATURES`) in the transport entry point, so adding a
capability never requires editing the main handler — only appending to the list.

## 4. Storage strategy

| Concern | Store | Reason |
|---|---|---|
| Users, channels, roles, settings | D1 | relational, queryable |
| Throttling, cooldowns, short cache | KV | fast, TTL |
| Uploaded videos, generated boards, attachments | R2 | large binary objects |
| Chess game state, live sessions | Durable Objects | stateful, low-latency, per-game isolation |
| Heavy jobs (video+SRT merge, AI batch) | Queues | off the request path, retryable |
| Conversation history | D1 + KV cache | durable but fast reads |

## 5. Feature notes

### 5.1 Channel / chat management (existing)
Already implemented (add channel, my channels, admin sync). Keep as-is; move into
`features/channels/`.

### 5.2 Chess simulation
- Engine: `chess.js` (pure JS, runs in Workers).
- State: Durable Object per game (`ChessGameDO`) holding FEN, move history, clocks.
- UI: inline keyboard for moves + rendered board image (SVG→PNG via a small renderer,
  or text/emoji board for MVP).
- Commands: `/chess`, `/chess move e2e4`, challenge a user.

### 5.3 SRT + video merge (MKVToolnix-like)
Workers cannot run ffmpeg. Design:
1. User sends video + `.srt` to the bot.
2. Bot stores both in R2, creates a job in the `media-merge` Queue.
3. A consumer (Cloudflare Container / external ffmpeg service / Queue consumer on a
   Node host) muxes subtitles into MKV/MP4 and writes result back to R2.
4. Bot notifies the user with a download link (R2 presigned URL or Telegram file).
Keep the bot request path free of heavy work; all muxing is async.

### 5.4 General assistant (AI)
- `AssistantService` wraps the LLM (Gemini or Workers AI).
- Conversation memory keyed by `chat_id` in D1, cached in KV.
- Triggered by plain text messages (not commands) or `/ask`.
- Tool/function calling can later expose chess/channel actions to the model.

### 5.5 Multi-device
- Core services are transport-agnostic.
- Add a JSON API under `/api/*` on the Worker + a web UI that reuses the same services.
- Auth: Telegram Login Widget → JWT; roles reused from D1.

## 6. Migration plan (step by step)

1. **Stabilize** (now): keep tests green; add compatibility aliases (e.g. `reportErrorToAdmin`).
2. **Extract core**: move services out of `src/telegram/services` into `src/services`; keep
   thin Telegram adapters.
3. **Feature registry**: ensure every feature is a pure registration function.
4. **Add chess MVP**: text board + move validation, state in D1 (upgrade to DO later).
5. **Add media pipeline**: R2 + Queue + external muxer, async notifications.
6. **Add assistant**: LLM integration with memory and rate limiting.
7. **Web/API**: expose services over HTTP for non-Telegram clients.
8. **Hardening**: D1 migrations, CI, health check, `.dev.vars.example`.

## 7. Non-functional requirements

- **CPU budget**: keep request handlers < 50ms; push heavy work to Queues/DO.
- **Resilience**: global error handler + throttled reporting (already present).
- **Security**: webhook secret validation, role checks, rate limits per user.
- **Observability**: structured logs, health endpoint, purge statistics table.
- **i18n**: Persian default, English fallback; strings in `src/core/i18n.ts`.

## 8. Immediate next steps

- [ ] Add `src/core/registry.ts` and migrate `FEATURES` array to use it.
- [ ] Add `ChessService` + `/chess` command (text board first).
- [ ] Add R2 binding + `MediaService` enqueue stub.
- [ ] Add `AssistantService` with Workers AI/Gemini behind a feature flag.
- [ ] Keep all existing tests passing after each step.

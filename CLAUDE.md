# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # Production — node server.js
npm run dev      # Development — nodemon server.js (auto-restart on changes)
```

There are no tests and no build step. The frontend is plain HTML/CSS/JS served as static files from `public/`.

## Architecture Overview

This is **Boostinghost** — a SaaS property management platform for short-term rental hosts, built as a Node.js monolith.

### Backend: `server.js` (~35,000 lines)

The entire backend lives in a single Express file. It contains:
- All route definitions (API + page serving)
- PostgreSQL database initialization (`initDb()`) — tables are created with `CREATE TABLE IF NOT EXISTS` on startup, so schema migrations run automatically
- Global middleware setup (cors, bodyParser, cookieParser, static files)
- Socket.IO real-time event handling
- Cron jobs via `node-cron`

The `pool` (PostgreSQL connection pool) is defined at the top-level and shared across all routes. It connects via `DATABASE_URL` env var.

### Modular route/service files

| File | Purpose |
|------|---------|
| `channex.js` | Channex OTA channel manager integration — syncs availability, rates, restrictions, and receives bookings from Airbnb/Booking.com/etc. |
| `integrated-chat-handler.js` | AI chat auto-response with 90s debounce — buffers rapid guest messages before sending to Groq |
| `groq-ai.js` | Groq LLM API wrapper for AI-generated guest responses |
| `sub-accounts-middleware.js` | JWT auth supporting both main accounts and sub-accounts (cleaners/staff) |
| `arrival-messages-cron.js` | Scheduled automatic arrival messages to guests |
| `deposit-messages-cron.js` | Scheduled deposit/security deposit reminder messages |
| `routes/chat_routes.js` | Guest/owner messaging routes |
| `routes/welcomeRoutes.js` | Welcome book (livret d'accueil) CRUD |
| `routes/dynamic-pricing-routes.js` | Dynamic pricing rules and overrides |
| `routes/smart-locks-routes.js` | Igloohome smart lock integration |
| `services/notifications-service.js` | Firebase push notifications |
| `services/messagingService.js` | Email/Slack/Discord notification templates |
| `services/whatsappService.js` | WhatsApp messaging via API |
| `services/welcomeGenerator.js` | HTML generation for welcome books |

### Authentication

Two account types share a JWT-based auth system:
- **Main users** — `authenticateToken` middleware, token payload contains `{ id, email, ... }`
- **Sub-accounts** (cleaners/staff) — `authenticateAny` middleware, token payload contains `{ subAccountId, type: 'sub_account' }`

Use `authenticateAny` (from `sub-accounts-middleware.js`) on all protected routes — it handles both types. Use `requirePermission(pool, 'can_view_x')` for granular per-sub-account access control. `getRealUserId(req)` returns the parent user ID regardless of whether the request is from a main account or sub-account.

### Frontend

Multi-page app (MPA) — each section is a separate HTML file in `public/`. JavaScript is vanilla, with no framework or bundler. Key JS files in `public/js/`:
- `app.js` — main dashboard logic
- `auth-fetch.js` — fetch wrapper that injects the JWT token from cookies
- `auth-manager.js` — login/logout, token refresh
- `bh-layout.js` / `bh-theme-v3-nav.js` — shared navigation/layout
- `messages.js` / `chat-owner.js` — messaging UI

The same `public/` folder is served by the iOS and Android Capacitor apps (see `capacitor.config.json`). The `ios/App/App/public/` directory mirrors `public/` for native builds.

### Key External Integrations

| Service | Env vars | Purpose |
|---------|---------|---------|
| Channex.io | `CHANNEX_API_KEY`, `CHANNEX_ENV` | OTA channel manager (production vs staging) |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUBSCRIPTION_SECRET_KEY` | Payments + subscriptions |
| Firebase | (JSON config) | Push notifications via FCM |
| Groq | `GROQ_API_KEY` | AI auto-responses for guest chat |
| DeepL | `DEEPL_API_KEY` | Auto-translate guest messages (French → guest's language) |
| WhatsApp | `WHATSAPP_API_KEY`, `WHATSAPP_PHONE_ID` | Guest WhatsApp messaging |
| Brevo | (Brevo SDK) | Transactional email |
| Cloudinary | (Cloudinary SDK) | Photo/image uploads |
| PostgreSQL | `DATABASE_URL` | Primary database |

### Subscription & Permissions

`checkSubscription` middleware enforces plan limits. Routes that require an active subscription chain: `authenticateAny, checkSubscription`. The `sub-accounts-middleware.js` `requirePermission` helper checks per-sub-account permission columns (e.g. `can_view_calendar`, `can_manage_cleaning`, `can_view_payments`).

### Adding a New Property

Properties live in the `properties` database table (not hardcoded). Set `channex_enabled`, `channex_property_id`, `channex_room_type_id`, `channex_rate_plan_id` columns to enable OTA sync. `displayName(property)` (defined in `server.js`) returns `internal_name` if set, otherwise `name`.

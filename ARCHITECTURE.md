# Bull Tech — HFT Trading Dashboard

A real-time high-frequency trading (HFT) dashboard built with React, TypeScript, and Vite. Connects to an exchange simulator backend and HFT gateway for market data streaming, order execution, and P&L tracking.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| UI framework | React | 19.2.4 |
| Language | TypeScript | 5.9.3 |
| Build tool | Vite | 8.0.1 |
| Styling | Tailwind CSS | 4.2.2 |
| State management | Zustand | 5.0.12 |
| Charting | Lightweight Charts | 5.1.0 |
| Numeric precision | BigNumber.js | 10.0.2 |
| Routing | React Router DOM | 7.13.2 |
| Error tracking | Sentry (@sentry/react) | latest |
| Database | ClickHouse | — |

---

## Technology Choices

### React 19

**Performance:** Concurrent rendering lets React interrupt low-priority work (e.g. re-rendering a large order history list) to keep the price ticker and chart responsive to high-frequency WebSocket updates. `React.memo` + granular Zustand selectors mean components only re-render when their specific data slice changes — critical when ticks arrive at 100/sec.

**Scalability:** The component model scales well as the dashboard grows. Adding a new panel (e.g. depth chart, heatmap) means a new isolated component with its own Zustand selector — no coordination with existing components required.

**Maintainability:** Hooks eliminate class component lifecycle complexity. The explicit data flow (Zustand → selector → component) makes render behaviour predictable and debuggable. StrictMode double-invocation catches side effects in development before they cause production bugs.

**Alternatives considered:** Vue 3 and Svelte are both fast. React was chosen because its ecosystem (Sentry SDK, lightweight-charts React wrapper, extensive hook patterns for WebSocket) is more mature for real-time financial dashboards, and TypeScript integration is first-class.

---

### TypeScript (strict mode)

**Performance:** No runtime cost — TypeScript compiles to plain JavaScript. The performance benefit is indirect: catching type errors at build time prevents incorrect data handling (e.g. treating a `string` balance as a `number`) that would cause silent incorrect calculations at runtime.

**Scalability:** As the codebase grows, strict types act as machine-checked documentation. Adding a new WebSocket message field requires updating the `WsMessage` interface first — the compiler then finds every handler that needs updating. Without types, this would require manual audit of every consumer.

**Maintainability:** `strict: true` + `noUncheckedIndexedAccess` forces explicit handling of `undefined` from array lookups and optional fields. This is especially important for financial data where a silent `NaN` from an unguarded parse is worse than a type error that stops the build.

**Alternatives considered:** Plain JavaScript. Rejected because the WebSocket message shape, Zustand store shape, and API response shapes form a complex contract between frontend and backend — types make violations immediately visible rather than showing up as runtime bugs in production.

---

### Vite

**Performance:** Native ESM in development means only changed modules are re-evaluated on save — HMR updates in under 50ms regardless of project size. Webpack rebuilds the entire bundle dependency graph. At scale (hundreds of components) this difference becomes large enough to affect development iteration speed.

**Scalability:** Vite's plugin ecosystem (Rollup-compatible) handles code splitting, dynamic imports, and tree-shaking out of the box. The dev proxy middleware (`vite.config.ts`) eliminates CORS issues in development without any backend changes.

**Maintainability:** Zero-config TypeScript and React support. The mock API middleware is colocated in `vite.config.ts` — a single file controls both the build and the development environment.

**Alternatives considered:** Create React App (deprecated), webpack. Both are slower in development. Next.js was considered but rejected — this is a pure SPA with no server-side rendering needs, and Next.js's file-based routing and server components would add complexity without benefit.

---

### Zustand

**Performance:** Zustand's selector model (`useTradeStore(state => state.prices[symbol]?.bbo)`) means components subscribe only to the exact slice they need. A price tick that updates `bbo` does not re-render `MetricsPanel` (which selects `telemetry`). Redux would require careful memoization with `reselect` to achieve the same. Zustand does this by default.

**Scalability:** The store scales by adding new state slices and actions with no boilerplate. Middleware (localStorage persistence) is a one-line addition. The BigNumber-aware serializer/deserializer is self-contained.

**Maintainability:** The entire store is defined in a single `store.ts` file (~200 lines). There are no action creators, reducers, or selectors to keep in sync. The `set` function is synchronous and predictable. Debugging with Zustand DevTools works the same as Redux DevTools.

**Alternatives considered:** Redux Toolkit — more boilerplate, more files, but better for teams that need strict action audit trails. Jotai/Recoil — atom-based models are good for independent pieces of state but less natural for a deeply nested shared market data structure. Context API — re-renders every consumer on any state change, unacceptable at 100 ticks/sec.

---

### Lightweight Charts (TradingView)

**Performance:** Renders using WebGL/Canvas rather than SVG. SVG-based chart libraries (Chart.js, Recharts) create a DOM node per data point — at 1,440 candles for a 24h 1m chart this causes layout thrashing on updates. Lightweight Charts renders the entire chart in a single canvas draw call.

**Scalability:** Handles 1M+ data points with no visible degradation. The `update()` API appends a single new candle without redrawing historical data — ideal for live tick updates at 100/sec.

**Maintainability:** The API surface is small and stable (TradingView uses this library in production on their platform). The `CandlestickSeries` API maps directly to OHLCV data with no transformation layer needed.

**Alternatives considered:** Chart.js — general-purpose, SVG, not optimised for financial data. D3.js — maximum flexibility but requires building candlestick rendering from scratch (~500 lines). Recharts — React-native but SVG-based and not designed for real-time updates.

---

### BigNumber.js

**Performance:** Slower than native `float64` arithmetic, but for a trading dashboard this is irrelevant — price display and P&L calculation happen at most 10 times per second per symbol. The correctness benefit far outweighs the negligible CPU cost.

**Scalability:** `BigNumber` serializes cleanly to/from strings for localStorage persistence and JSON API responses. The custom `__BN__` prefix serializer in Zustand handles this transparently.

**Maintainability:** Makes incorrect arithmetic visible. `new BigNumber('0.1').plus('0.2').toString()` returns `'0.3'` exactly. `0.1 + 0.2` in float64 returns `0.30000000000000004`. For balance displays and P&L calculations this difference is user-visible.

**Alternatives considered:** `decimal.js` — similar precision guarantees, slightly smaller bundle. BigNumber.js was chosen for its wider ecosystem adoption and the fact that it was already in use for BBO fixed-point decoding.

---

### Sentry

**Performance:** The SDK is lazy-loaded and gated on `VITE_SENTRY_DSN`. When the DSN is absent (development, CI) the SDK never initialises and has zero runtime overhead. Session replay is sampled at 1% to avoid bandwidth cost.

**Scalability:** Sentry's error grouping automatically deduplicates repeated errors across thousands of users. Source maps uploaded at build time give readable stack traces without exposing source code in the bundle.

**Maintainability:** Errors in production are surfaced with the exact component stack, user context, and replay — eliminating the need to reproduce browser-specific bugs manually. The `VITE_SENTRY_DSN` environment variable pattern means the same build artifact works in staging (no DSN) and production (with DSN).

**Alternatives considered:** Datadog RUM, LogRocket. Both are more expensive and require more configuration. Sentry's free tier covers the usage level of this project, and its React SDK has first-class support for error boundaries and component-level tracing.

---

## Project Structure

```
state/
├── index.html                         # SPA entry point
├── vite.config.ts                     # Build config + dev proxy + mock API middleware
├── vercel.json                        # Production: CSP headers + API rewrites
├── tsconfig.app.json                  # Strict TypeScript config (ES2023)
├── eslint.config.js                   # ESLint 9 flat config (TS + React hooks)
├── src/
│   ├── main.tsx                       # App entry (StrictMode + Sentry init)
│   ├── App.tsx                        # Root: routing + auth guard + WS status badge + toast alerts
│   ├── MarketDashboard.tsx            # Main 3-column dashboard layout
│   ├── store.ts                       # Zustand global state + localStorage persistence
│   ├── auth.ts                        # Token storage + authFetch wrapper
│   ├── logger.ts                      # Structured logging (pretty dev / JSON prod)
│   ├── useMarketDataStream.ts         # WebSocket hook (buffered, reconnecting, StrictMode-safe)
│   ├── usePriceAlerts.ts              # Price alert execution hook
│   ├── usePendingOrders.ts            # Limit/stop-limit order execution hook
│   ├── index.css                      # Global styles + Tailwind + dark theme
│   ├── hooks/
│   │   └── useOrderForm.ts            # Per-side qty state, validation, quick-amount calc
│   ├── components/
│   │   ├── TradeInterface.tsx         # Tab shell: Spot / Alerts / PnL / Orders tabs
│   │   ├── OrderFormColumn.tsx        # Buy or sell column (uses useOrderForm)
│   │   ├── AlertsTab.tsx              # Alert creation + active alerts + pending orders + Cancel All
│   │   ├── OrderHistoryPanel.tsx      # Per-order transaction log with side/status filters
│   │   ├── Chart.tsx                  # Candlestick chart (timeframe selector, historical + live)
│   │   ├── OrderBook.tsx              # Level 2 BBO order book (memoized)
│   │   ├── TopTickerBar.tsx           # Price, 24h/1h change, latency/throughput bar
│   │   ├── MetricsPanel.tsx           # Latency, throughput, error rate cards (memoized)
│   │   ├── PnlPanel.tsx               # Realized/unrealized P&L + open positions + refresh
│   │   └── ErrorBoundary.tsx          # React error boundary for chart crashes
│   └── pages/
│       ├── Login.tsx                  # Login form + token storage
│       └── Register.tsx               # Registration form (10k USDC starting balance)
└── db/
    ├── init/init.sql                  # ClickHouse database + user setup
    ├── schemas/
    │   ├── historical_trades.sql      # Raw tick data (Decimal64, ZSTD)
    │   ├── market_ohlc.sql            # 1-min OHLCV candles (30d TTL)
    │   └── system_metrics.sql         # Latency/throughput/error logs
    └── queries/
        ├── ohlcv_candles.sql              # Manual OHLCV aggregation (fallback)
        ├── materialized_view_1m.sql       # Pre-computed 1-min candles (MV)
        └── materialized_views_multi.sql   # 5m / 15m / 1h / 1d MVs + backfill queries
```

---

## Architecture

### State Management

Zustand is used for all global state. The store holds two categories of data:

- **Ephemeral (not persisted):** `prices`, `alerts`, `wsStatus`. These are repopulated from the WebSocket on each session and never written to localStorage.
- **Persisted to localStorage:** `priceAlerts`, `pendingOrders`. These survive page reloads and are restored on startup.

Persistence uses a custom BigNumber serializer/deserializer (`__BN__` prefix) because `JSON.stringify` loses BigNumber instances.

```
store.ts
├── MarketData       — per-symbol price, volume, BBO, tick, OHLC, telemetry
├── BboSnapshot      — best bid/ask + 5 levels each side
├── PriceAlert       — target price, above/below condition, buy/sell action
├── PendingOrder     — limit or stop-limit, waiting/triggered status
├── Alert            — toast notification (critical/info)
└── WsStatus         — 'connecting' | 'connected' | 'reconnecting'
```

Bulk management actions `clearPendingOrders(symbol?)` and `clearPriceAlerts(symbol?)` clear all orders/alerts globally or scoped to a symbol.

### WebSocket Data Flow

`useMarketDataStream` connects to `VITE_WS_URL`. It does not pass raw messages directly to React state:

1. Incoming messages are written into a per-symbol buffer (latest update only).
2. A 100ms interval flushes the buffer into Zustand (`updatePrice`), atomically clearing it.
3. `updatePrice` deep-merges the partial update. Optional fields (`change_1h`, `change_24h`, `bbo`, `ohlc`, `tick`, `telemetry`) are only written to the partial when the raw message actually includes them — absent fields are never set to `undefined` in the partial, so spread-merge never overwrites existing store values with `undefined`.
4. Telemetry values (latency, throughput, error rate) are smoothed with EMA (α=0.05) to reduce visual noise.
5. `setWsStatus` is called at each connection lifecycle event: `connecting` before socket creation, `connected` on open, `reconnecting` on close.

Reconnection uses exponential backoff: 500ms → 1s → 2s → ... → 30s ceiling, resetting on successful connect.

**React StrictMode safety:** The hook uses a closure-local `isMounted` boolean (not a ref) to track whether a given effect instance is still live. Using a ref was unsafe because StrictMode mounts, unmounts, and remounts the effect — the second mount would reset the ref to `true` before the first socket's async `onclose` fired, causing spurious reconnects. With a closure variable, each effect instance owns its own flag independently.

The `WsStatusBadge` component in `App.tsx` reads `wsStatus` from the store and renders a green/amber/red pill in the header:
- Green + pulse: connected
- Amber + pulse: reconnecting (in backoff)
- Red: initial connection attempt in progress

### Order Execution Architecture

The exchange-sim backend only accepts **market orders**. There is no native support for limit or stop-limit orders at the API level. These are implemented entirely on the frontend:

- **`usePriceAlerts`:** Watches live prices against stored `priceAlerts`. When a condition is met (price crosses target), fires a market order via `POST /api/v1/orders` and removes the alert.
- **`usePendingOrders`:** Manages limit and stop-limit orders stored in Zustand.
  - **Limit:** Executes when `currentPrice <= limitPrice` (buy) or `currentPrice >= limitPrice` (sell).
  - **Stop-limit (two-phase):**
    - Phase 1 (`waiting`): Monitor for `stopPrice` cross → transition to `triggered`.
    - Phase 2 (`triggered`): Behave as a limit order on `limitPrice`.

Both hooks use refs (`firingRef`, `submittingSymbolsRef`) to prevent double-execution and serialize API calls per symbol.

### TradeInterface Component Architecture

`TradeInterface.tsx` is a thin shell (~180 lines) responsible for:
- Tab routing (Spot / Alerts / PnL / Orders)
- Account data fetch (`GET /api/v1/account`) with error state and retry button
- Shared order-type state (`orderType`, `limitPrice`, `stopPrice`) passed to both columns
- `handleExecute` — validates and dispatches market, limit, or stop-limit orders
- Result overlay modal with optimistic pending state

**Optimistic UI:** Market order submission immediately shows a blue "Submitting…" overlay with a pulse indicator. The modal transitions to green (filled) or red (rejected) when the API responds. The close button is suppressed while the result is pending so the user cannot dismiss before confirmation arrives.

The spot tab renders two `OrderFormColumn` instances (buy and sell). Each column uses the `useOrderForm` hook which owns per-side `qty` state, quantity validation, and quick-amount calculation. The alert creation form, active alerts list, and pending orders list live in `AlertsTab`.

### Render Performance

`OrderBook` and `MetricsPanel` use granular Zustand selectors:

```typescript
// OrderBook — only the BBO slice
const bbo = useTradeStore((state) => state.prices[symbol]?.bbo);

// MetricsPanel — only the telemetry slice
const telemetry = useTradeStore((state) => state.prices[symbol]?.telemetry);
```

Both components are wrapped with `React.memo`. Because `bbo` and `telemetry` are only replaced with new object references when their data actually changes (absent fields preserve the existing reference through spread-merge), components skip re-renders on every price or OHLC tick that does not affect them.

### Chart Data Flow

1. On symbol selection or timeframe change, `Chart.tsx` fetches historical OHLCV from `/api/v1/ohlcv/{symbol-slug}?interval={tf}&minutes={window}`.
2. Five timeframes are available: 1m (24h window), 5m (5d), 15m (15d), 1h (30d), 1d (3 months). A pill selector is overlaid top-left of the chart.
3. The fetch is tied to an `AbortController`. The cleanup function calls `abortController.abort()` before removing the chart, preventing the React StrictMode double-invoke from firing two concurrent requests (which could trigger backend rate limits).
4. Data is loaded into a `CandlestickSeries` from lightweight-charts via `setData`.
5. Live `ohlc` updates from Zustand are applied to the series as they arrive from the WebSocket.

**Multi-timeframe backend:** The `interval` query parameter routes to the correct ClickHouse MV. The HFT gateway (`fpga-hft-data-generator/src/api.rs`) accepts `?interval=1m|5m|15m|1h|1d` and passes it to `get_historical_ohlc` in `db.rs`, which selects the appropriate `AggregatingMergeTree` view using `*Merge` aggregate functions. If the MV is empty (e.g. before backfill), the query falls back to on-the-fly `GROUP BY` aggregation from raw trades using the correct interval truncation (`toStartOfInterval`, `toStartOfHour`, `toStartOfDay`).

### Real-Time Update Pipeline

The full path from a server-generated tick to a rendered component re-render:

```
fpga-hft-data-generator (every 10ms)
  └─ GBM tick → broadcast::Sender (pre-serialised JSON string)
       └─ WebSocket frame → browser
            └─ useMarketDataStream.onmessage
                 └─ JSON.parse → raw WsMessage (typed interface)
                      └─ write into per-symbol buffer
                           (overwrites any earlier unprocessed message for that symbol)

setInterval (every 100ms)
  └─ flush buffer → Zustand.updatePrice(partial)
       └─ partial deep-merge:
            - price, volume always updated
            - bbo, ohlc, tick, telemetry only written when present in message
            - change_1h, change_24h only written when present in message
            - absent fields: partial object never gets the key → spread-merge is a no-op
       └─ EMA-smooth telemetry (α = 0.05)
       └─ Zustand notifies all active selectors

React commit (synchronous, same microtask)
  └─ TopTickerBar     — subscribes to prices[symbol].price, volume, change_1h, change_24h
  └─ OrderBook        — subscribes to prices[symbol].bbo (only re-renders if bbo ref changed)
  └─ MetricsPanel     — subscribes to prices[symbol].telemetry (only if telemetry ref changed)
  └─ Chart            — subscribes to prices[symbol].ohlc → chart.update(bar)
```

**Why 100ms buffer instead of immediate state update:**
At 100 ticks/sec (10ms interval) calling `setState` on every message would schedule 100 React render cycles per second. React batches state updates within event handlers but not across separate `onmessage` calls. The 100ms interval reduces renders to 10/sec while showing the latest data — a rate imperceptible to human users but with 90% less render work.

**Why per-symbol buffer with latest-wins semantics:**
If two ticks arrive in the same 100ms window, only the most recent matters for display purposes. Queuing both would produce two consecutive state updates and two render passes. The buffer collapses any number of updates within the window into a single Zustand write.

---

### State Synchronization & Consistency Guarantees

**Single source of truth.** All market data lives in one Zustand store. No component holds its own copy of price or BBO data. When the 100ms flush writes to the store, every component that subscribes to that data re-renders in the same React commit cycle — there is no window where `TopTickerBar` shows the new price while `OrderBook` still shows the old BBO.

**React batching guarantees atomic commits.** React 19 batches all state updates triggered within a single synchronous call. The `updatePrice` Zustand action is a synchronous `set` call inside the `setInterval` callback — React processes all resulting selector notifications in one pass and commits a single new DOM snapshot. Components cannot observe a half-updated store.

**Partial merge prevents false zeroes.** A WebSocket message may include only `{price, volume}` and omit `change_1h`. Writing `change_1h: undefined` (or `BigNumber(0)` from a `null`) to the store would overwrite the last known value, causing the ticker to show `▲ 0.00%` until the next real poll. Two guards prevent this: (1) Rust omits the field entirely when `None` via `skip_serializing_if`, so `raw.change_1h` is `undefined` in JS; (2) the frontend guard is `!= null` (catches both `null` and `undefined`). Absent keys are never written to the partial, so the store retains the last known value indefinitely.

**Referential stability for memoized components.** When a tick updates `price` but the message contains no `bbo` key, the `bbo` object in the store is not replaced — the same object reference survives the merge. Zustand compares selector return values by reference. `OrderBook`'s selector returns the same `bbo` reference → Zustand does not notify `OrderBook` → `React.memo` does not schedule a re-render. This is why granular selectors (`prices[symbol]?.bbo`) are used instead of selecting the entire `prices[symbol]` object.

**Stale data on disconnect.** When the WebSocket closes, the buffer stops being flushed and Zustand is not updated. Components continue to display the last known values rather than showing empty or zeroed state. The `WsStatusBadge` (amber/red) communicates to the user that data may be stale. This is the correct trade-off for a dashboard: stale prices with a visible indicator are more useful than blank panels.

**No cross-component coordination.** Components do not communicate with each other. `TopTickerBar` does not tell `OrderBook` about a price change — both independently subscribe to Zustand and both receive the update in the same React commit. There is no event bus, no prop drilling of live data, and no ordering dependency between component updates.

**Limit/alert order consistency.** `usePendingOrders` and `usePriceAlerts` read `prices[symbol].price` from Zustand on the same 100ms flush cycle as the UI components. The price they use to evaluate crossing conditions is always the same price the user sees on screen — there is no parallel price feed or separate polling interval that could produce a different value.

**Optimistic UI consistency.** Market orders show a blue "Submitting…" overlay immediately on click — before the API responds. The overlay prevents the user from submitting a second order while the first is in flight. When the API responds, the overlay updates to green/red and the account balance is reloaded. During the in-flight window the displayed balance is deliberately stale (showing the pre-order balance) to avoid confusing the user with a partially-updated state.

---

### Numeric Precision

All financial values use `BigNumber.js`. Float arithmetic is never used for prices or quantities. ClickHouse stores prices and amounts as `Decimal64(8)` (8 decimal places). The order book component divides raw values by 100,000,000 to match the fixed-point encoding from the Rust backend.

All WebSocket message fields are parsed through `toBN(val: unknown)` which uses a type guard (`typeof val !== 'string' && typeof val !== 'number'`) before constructing a BigNumber, satisfying TypeScript strict mode without unsafe casts.

### Authentication

Tokens are stored in `localStorage` as `exchange_token` and `exchange_user`. `authFetch` is a thin wrapper that injects `Authorization: Bearer {token}` into every API call. On 401, auth is cleared and the user is redirected to `/login`.

`EXCHANGE_URL` is read from `VITE_EXCHANGE_URL`. An empty string is valid and signals Vercel rewrite mode — all exchange API calls become relative paths and are proxied by `vercel.json`. Only a fully absent variable (not set in `.env` at all) throws at startup.

`RequireAuth` is a React component that checks `isLoggedIn()` on every render; unauthenticated users are redirected to `/login` via React Router.

---

## Security

### Authentication Implementation

**Token lifecycle:**
1. User submits credentials → `POST /api/v1/auth/login` → exchange-sim validates bcrypt hash → returns JWT
2. JWT is stored in `localStorage` under `exchange_token`
3. Every subsequent API call goes through `authFetch`, which reads the token from localStorage and injects `Authorization: Bearer <token>` into the request header
4. On any `401 Unauthorized` response, `clearAuth()` wipes both localStorage keys and React Router redirects to `/login`
5. On logout, `POST /api/v1/auth/logout` is called to add the token's `jti` to the exchange-sim blocklist before clearing localStorage

**localStorage vs httpOnly cookies — conscious trade-off:**
Storing JWTs in `localStorage` exposes them to JavaScript, which means an XSS attack that executes arbitrary JS can exfiltrate the token. `httpOnly` cookies are not readable by JS and are the safer alternative for production. The trade-off made here:

- `localStorage` was chosen because the frontend makes cross-origin requests in development (before Vercel rewrites) where cookie `SameSite` rules would block them
- The XSS vector is mitigated by the Content Security Policy (see below), which blocks inline script injection — the primary delivery mechanism for XSS token theft
- For a production financial service, migrating to `httpOnly` `Secure` `SameSite=Strict` cookies is the correct hardening step

**CSRF protection:** Bearer token authentication is inherently CSRF-safe. CSRF attacks exploit the browser's automatic cookie inclusion on cross-origin requests. Since the JWT is injected manually by `authFetch` from localStorage, a forged cross-origin form submission cannot include it — the attacker's page has no access to localStorage on the dashboard origin.

---

### Authorization

The frontend enforces two authorization boundaries:

**Route-level guard — `RequireAuth`:**
```
App.tsx
└─ <RequireAuth>           ← checks isLoggedIn() (localStorage token present)
     └─ <MarketDashboard>  ← only rendered when authenticated
          └─ <TradeInterface>, <Chart>, <OrderBook>, ...
```
`RequireAuth` runs on every render. If `isLoggedIn()` returns false (token absent or cleared by a 401), React Router immediately redirects to `/login`. There is no route in the authenticated tree that can be reached without a token.

**API-level enforcement:** All route protection is ultimately enforced by the exchange-sim backend. The frontend guard is a UX convenience — it prevents navigation to the dashboard page — but it cannot and does not replace server-side token verification. Every API call that succeeds requires the backend to have verified the JWT signature and expiry.

**Role visibility:** The frontend does not render different UI for `trader` vs `admin` roles. Admin-only capabilities (balance adjustment, user management) are accessible only through the exchange-sim admin API endpoints, which enforce the `admin` role claim in the JWT. The dashboard is a trader-facing interface only.

---

### Sensitive Data Protection

**Credentials never stored:** Passwords are submitted once to `/api/v1/auth/login` and never held in JavaScript state or localStorage. Only the resulting JWT is persisted.

**No financial data in localStorage:** Zustand's localStorage persistence covers only `priceAlerts` and `pendingOrders` (target prices and quantities). Account balances, order history, and position data are fetched from the API on demand and held only in ephemeral Zustand state — they are cleared on page unload and never written to disk.

**Environment variables:** All secrets (API URLs, Sentry DSN) are injected at build time via `VITE_*` env vars. They are embedded in the JS bundle but never exposed in URLs or request bodies. `VITE_SENTRY_DSN` is the only value that could be considered sensitive — it identifies the Sentry project but does not grant write access to data.

---

### Transport Security

**HTTPS enforcement (production):** Vercel serves all responses over HTTPS and redirects HTTP to HTTPS automatically. The Vite dev server uses plain HTTP, which is acceptable for localhost development.

**WebSocket TLS:** `VITE_WS_URL` must be a `wss://` URL in production. The direct WS connection (which bypasses Vercel) relies on the backend being reachable over TLS. The backend must have a valid certificate for the browser to allow the `wss://` upgrade.

**REST API (production):** All REST calls from the browser go to Vercel (`https://`) which then rewrites to the backend. The backend-to-Vercel hop is within Vercel's infrastructure. For full end-to-end encryption, the backend itself should also serve HTTPS.

---

### Content Security Policy

`vercel.json` injects the following headers on every response, reducing the attack surface for XSS and clickjacking:

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'`; controlled script/style allowlist; `connect-src` restricted to known WSS and API origins | Blocks injection of foreign scripts; restricts where JS can connect |
| `X-Frame-Options` | `DENY` | Prevents the dashboard from being embedded in an iframe (clickjacking) |
| `X-Content-Type-Options` | `nosniff` | Prevents browsers from MIME-sniffing responses as a different content type |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer header exposure to same-origin navigations |
| `Permissions-Policy` | camera, microphone, geolocation all blocked | Removes access to browser APIs the dashboard never uses |

**CSP and XSS:** The CSP `script-src` directive restricts which scripts can execute. Even if an attacker injects a `<script>` tag through a hypothetical XSS vector, the browser will refuse to execute scripts from unlisted origins. This is the primary defence that makes the `localStorage` token storage acceptable.

---

### Security Gaps (Production Hardening Required)

| Gap | Risk | Recommended fix |
|---|---|---|
| JWT in localStorage | XSS can exfiltrate token | Migrate to `httpOnly Secure SameSite=Strict` cookies |
| No token expiry UI | Expired token causes silent 401 on first API call | Show "Session expired — please log in again" banner on 401 |
| No HTTPS on dev WS | `ws://` in development | Acceptable for localhost; enforce `wss://` via env var validation before production deploy |
| Admin UI absent | Admin operations require direct API calls | Build admin panel for balance and user management |

### Structured Logging

`src/logger.ts` exports a `logger` object with `debug / info / warn / error` methods, each accepting a message string and an optional context object.

- **Development:** Pretty-prints with level prefix to the browser console.
- **Production:** Emits `JSON.stringify`-ed `LogEntry` objects, consumable by DataDog, CloudWatch Logs, or any JSON-aware log aggregator.

`console.error` and `console.warn` in the WebSocket hook and Chart component are replaced with `logger.error` / `logger.warn` so all runtime errors flow through the structured sink.

### Error Tracking (Sentry)

Sentry is initialized in `main.tsx` and gated on the `VITE_SENTRY_DSN` environment variable. When the DSN is absent the SDK is never loaded. Configuration:

- 10% transaction sampling (`tracesSampleRate: 0.1`)
- 1% session replay, 100% replay on error

Set `VITE_SENTRY_DSN` in the Vercel environment variables dashboard to activate in production.

---

## Production Deployment (Vercel)

### CORS Strategy

The Vite dev proxy (`vite.config.ts`) only runs during `npm run dev`. In production, CORS is handled differently for each request type:

**REST endpoints — `vercel.json` rewrites (same-origin proxying):**

```
/api/v1/ohlcv/*  →  https://your-hft-gateway.example.com/api/v1/ohlcv/*
/api/*           →  https://your-exchange-sim.example.com/api/*
```

Rewrite order matters: the ohlcv rule is evaluated first so HFT gateway OHLCV calls are not captured by the broader exchange-sim rule.

With both `VITE_API_URL=` and `VITE_EXCHANGE_URL=` set to empty, all REST calls use relative paths and Vercel routes them to the correct backend without any CORS headers needed on the backends.

**WebSocket — direct URL with backend CORS:**

Vercel rewrites do not proxy WebSocket connections. `VITE_WS_URL` must be a direct `wss://` address. The backend must accept the `Origin` header from the Vercel app domain during the HTTP upgrade handshake.

### Content Security Policy

`vercel.json` injects the following security headers on every response:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; scripts/styles inline allowed; fonts from googleapis; `connect-src` allows wss + https; no iframes |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation all blocked |

### Environment Variables

**Development (`.env`):**

```env
VITE_WS_URL=ws://localhost:5173/v1/feed   # Routes through Vite dev proxy → ws://localhost:8080
VITE_API_URL=                             # Empty = relative paths, proxied by Vite dev server
VITE_EXCHANGE_URL=http://localhost:8081   # Exchange simulator (direct, has CORS enabled)
VITE_MOCK_API=true                        # Enable mock trade responses (dev only)
```

**Production (Vercel dashboard):**

```env
VITE_WS_URL=wss://your-hft-gateway.example.com/v1/feed
VITE_API_URL=                   # Empty — vercel.json rewrites /api/v1/ohlcv/* to HFT gateway
VITE_EXCHANGE_URL=              # Empty — vercel.json rewrites /api/* to exchange sim
VITE_SENTRY_DSN=https://...    # Sentry DSN — omit to disable error tracking
```

When `VITE_MOCK_API=true`, Vite intercepts `POST /api/execute-trade` in the dev server middleware and returns a random 50/50 success/failure with a 500ms delay — never set this in production.

---

## ClickHouse Database Design

### Overview

Two ClickHouse databases serve the full system. `hft_dashboard` is owned by `fpga-hft-data-generator` and holds all market data. `exchange` is owned by `exchange-sim` and holds all account state. `exchange-sim` also holds a cross-database `SELECT` grant on `hft_dashboard` so it can read live prices directly.

The authoritative schema is in `clickhouse-config/init.sql`. The `fpga-hft-data-generator/schema/schema.sql` file is a developer-facing subset used for standalone bringup without Docker Compose.

---

### Databases and Ownership

| Database | Owner service | Tables |
|---|---|---|
| `hft_dashboard` | `fpga-hft-data-generator` | `historical_trades`, `market_ohlc`, 5 materialized views |
| `exchange` | `exchange-sim` | `users`, `orders`, `positions` |

ClickHouse users:
- `inserter_user` — INSERT + SELECT on `hft_dashboard.*`
- `exchange_user` — INSERT + SELECT on `exchange.*`, SELECT on `hft_dashboard.*`

---

### Table Reference

#### `hft_dashboard.historical_trades`

Raw trade ticks written by `fpga-hft-data-generator` at up to 100 ticks/sec per symbol.

```sql
ENGINE = MergeTree()
ORDER BY (symbol, timestamp)
PARTITION BY toYYYYMM(timestamp)
TTL toDateTime(timestamp) + INTERVAL 2 HOUR DELETE
```

| Column | Type | Codec | Notes |
|---|---|---|---|
| `symbol` | String | ZSTD(3) | Trading pair, e.g. `SOL/USDC` |
| `side` | Int8 | — | 1 = buy, 2 = sell |
| `price` | Decimal64(8) | ZSTD(3) | 8 decimal places |
| `amount` | Decimal64(8) | ZSTD(3) | 8 decimal places |
| `timestamp` | DateTime64(6) | DoubleDelta + ZSTD(1) | Microsecond UTC |
| `order_id` | String | ZSTD(3) | UUID |
| `trader_id` | UInt32 | ZSTD(1) | Simulated trader identity |

**Design rationale:**
- `ORDER BY (symbol, timestamp)` — all time-range queries filter on `symbol` first. ClickHouse physically sorts data by this key, so a `WHERE symbol = 'SOL/USDC' AND timestamp >= ...` scan skips all granules that don't match — no full table scan.
- `PARTITION BY toYYYYMM(timestamp)` — monthly partitions bound the scan surface for time-bounded queries and allow `ALTER TABLE DROP PARTITION` for bulk data removal without rewriting the table.
- `DoubleDelta` codec on `timestamp` — optimal for monotonically increasing integers with regular spacing (HFT tick data). Compresses sequential microsecond timestamps by ~80% vs raw storage.
- `ZSTD(3)` on price/amount/symbol — ZSTD at level 3 favours compression ratio; suitable for columns written in large batches rather than read on the critical path.
- TTL 2 hours — intentionally short for this synthetic simulator. At 100 ticks/sec × 2 symbols the table would grow ~60 million rows/hour; the 2-hour window keeps storage bounded while still supporting 1m chart backfill.

---

#### `hft_dashboard.market_ohlc`

Pre-aggregated 1-minute OHLCV candles written by `fpga-hft-data-generator` on candle close.

```sql
ENGINE = ReplacingMergeTree()
ORDER BY (symbol, candle_time)
PARTITION BY toYYYYMM(candle_time)
TTL toDateTime(candle_time) + INTERVAL 90 DAY DELETE
```

| Column | Type | Codec | Notes |
|---|---|---|---|
| `symbol` | String | ZSTD(3) | |
| `candle_time` | DateTime64(6) | DoubleDelta + ZSTD(1) | Minute boundary (UTC) |
| `open` | Decimal64(8) | ZSTD(3) | First price in candle |
| `high` | Decimal64(8) | ZSTD(3) | |
| `low` | Decimal64(8) | ZSTD(3) | |
| `close` | Decimal64(8) | ZSTD(3) | Last price in candle |
| `volume` | Decimal64(8) | ZSTD(3) | Sum of `amount` in candle |
| `change_1h` | Decimal64(8) | ZSTD(3) | % change vs price 1h ago |
| `change_24h` | Decimal64(8) | ZSTD(3) | % change vs price 24h ago |

**Design rationale:**
- `ReplacingMergeTree()` — ClickHouse has no UPDATE. Candle values for an open (in-progress) minute change with every tick. Re-inserting a new row with the same `(symbol, candle_time)` key and reading with `FINAL` forces deduplication, providing upsert semantics without a transactional database.
- 90-day TTL — chart data beyond 3 months is rarely needed for a trading dashboard. Longer retention would require either larger monthly partitions or a separate cold-storage table.

---

#### `hft_dashboard.historical_trades_mv_*` (Materialized Views)

Five `AggregatingMergeTree` views that incrementally maintain OHLCV aggregates at each resolution. Populated automatically on every INSERT to `historical_trades`.

| View | Interval function | Typical query window |
|---|---|---|
| `historical_trades_mv_1m` | `toStartOfMinute` | 24 hours |
| `historical_trades_mv_5m` | `toStartOfInterval(..., INTERVAL 5 MINUTE)` | 5 days |
| `historical_trades_mv_15m` | `toStartOfInterval(..., INTERVAL 15 MINUTE)` | 15 days |
| `historical_trades_mv_1h` | `toStartOfHour` | 30 days |
| `historical_trades_mv_1d` | `toStartOfDay` | 3 months |

Each view stores partial aggregate states:

| Aggregate state | Resolves to | Query function |
|---|---|---|
| `argMinState(price, timestamp)` | First price (open) | `argMinMerge(open)` |
| `maxState(price)` | Highest price (high) | `maxMerge(high)` |
| `minState(price)` | Lowest price (low) | `minMerge(low)` |
| `argMaxState(price, timestamp)` | Last price (close) | `argMaxMerge(close)` |
| `sumState(amount)` | Total volume | `sumMerge(volume)` |

**Design rationale:**
- Without MVs, every chart load would `GROUP BY toStartOfInterval(timestamp, ...)` across potentially millions of raw tick rows. At 100 ticks/sec × 2 symbols the 1h view alone covers ~720,000 raw rows. The MV reduces this to a `GROUP BY` across ~60 pre-merged candles.
- `AggregatingMergeTree` stores binary intermediate state (not final values). Multiple inserts in the same candle window are merged in the background — the `*Merge` functions at query time finalise the state into usable values.
- Backfill: MVs only capture new inserts from creation time. The SQL file (`db/queries/materialized_views_multi.sql`) includes commented INSERT...SELECT backfill queries that re-aggregate existing `historical_trades` data — run these once on first deploy.

---

#### `exchange.users`

```sql
ENGINE = ReplacingMergeTree(created_at)
ORDER BY id
```

| Column | Type | Notes |
|---|---|---|
| `id` | String | UUID |
| `username` | String | Uniqueness enforced in-process (Mutex), not at DB level |
| `password_hash` | String | bcrypt |
| `role` | String | `'admin'` / `'trader'` |
| `balance_usdc` | String | Stored as decimal string to avoid float precision loss |
| `created_at` | DateTime64(6) | Version column — higher value wins on merge |
| `is_active` | UInt8 | Soft-delete flag |

**Design rationale:**
- `ReplacingMergeTree(created_at)` — balance updates re-insert a new row with a later `created_at`. The higher timestamp wins at merge time. All reads use `FINAL` to force dedup before background merges complete.
- `balance_usdc` as String — ClickHouse stores Decimal, but the exchange-sim serialises balances as decimal strings to avoid f64 rounding. Rust `rust_decimal::Decimal` parses the string at read time.
- No partition — the users table will have at most thousands of rows. Partitioning at this scale adds overhead with no benefit.

---

#### `exchange.orders`

```sql
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (user_id, id)
PARTITION BY toYYYYMM(created_at)
```

| Column | Type | Notes |
|---|---|---|
| `id` | String | UUID |
| `user_id` | String | FK to `exchange.users.id` |
| `symbol` | String | `'SOL/USDC'` etc. |
| `side` | String | `'buy'` / `'sell'` |
| `order_type` | String | `'market'` / `'limit'` |
| `price` | String | Fill price; `'0'` for pending limit orders |
| `amount` | String | Quantity in base asset |
| `total_usdc` | String | `price × amount` |
| `limit_price` | String | Empty for market orders |
| `status` | String | `'filled'` / `'rejected'` / `'pending'` / `'canceled'` |
| `reject_reason` | String | Empty when not rejected |
| `realized_pnl` | String | Empty for buys and pending orders |
| `created_at` | DateTime64(6) | Immutable — partition key |
| `updated_at` | DateTime64(6) | Version column |

**Design rationale:**
- `ReplacingMergeTree(updated_at)` — limit orders transition through states (`pending` → `filled` or `canceled`). Each transition re-inserts the row with a newer `updated_at`; `FINAL` at read time returns only the latest state.
- `ORDER BY (user_id, id)` — the most common read pattern is `WHERE user_id = ?`. Placing `user_id` first in the sort key makes per-user order history scans read a contiguous range of sorted data.
- `PARTITION BY toYYYYMM(created_at)` — monthly partitions bound the scan for time-filtered admin queries and enable partition-level archiving.

---

#### `exchange.positions`

```sql
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (user_id, symbol)
```

| Column | Type | Notes |
|---|---|---|
| `user_id` | String | |
| `symbol` | String | |
| `quantity` | String | Base asset held; `'0'` means no position |
| `avg_buy_price` | String | Weighted average cost basis |
| `updated_at` | DateTime64(6) | Version column |

**Design rationale:**
- `ORDER BY (user_id, symbol)` — position queries always filter on `user_id`. Positions are few per user (one per symbol) so no partition is needed.
- Non-zero filter: reads use `WHERE toFloat64OrZero(quantity) > 0` to exclude closed (zeroed) positions from the result set without physically deleting rows.

---

### DB Interactions — Cross-Service Summary

| Operation | Service | Table | Pattern |
|---|---|---|---|
| Tick INSERT (batched) | fpga-hft-data-generator | `hft_dashboard.historical_trades` | Buffered, flush every 1s or 1000 rows |
| Candle INSERT | fpga-hft-data-generator | `hft_dashboard.market_ohlc` | On minute boundary, per symbol |
| MV population | ClickHouse (automatic) | `historical_trades_mv_*` | Triggered by every INSERT to `historical_trades` |
| 1h change poll | fpga-hft-data-generator | `hft_dashboard.historical_trades` | `SELECT price ... WHERE timestamp <= now()-1h ORDER BY timestamp DESC LIMIT 1` every 5s |
| 24h change poll | fpga-hft-data-generator | `hft_dashboard.market_ohlc FINAL` | `SELECT close ... WHERE candle_time <= now()-1d ORDER BY candle_time DESC LIMIT 1` every 5s |
| OHLCV read | fpga-hft-data-generator | `hft_dashboard.market_ohlc` / MVs | On `GET /api/v1/ohlcv/{symbol}?interval=` |
| Candle backfill | fpga-hft-data-generator | `hft_dashboard.market_ohlc` | INSERT...SELECT on startup |
| User register | exchange-sim | `exchange.users` | INSERT new row |
| User login | exchange-sim | `exchange.users` | SELECT FINAL WHERE username = ? |
| Balance update | exchange-sim | `exchange.users` | Re-INSERT with new `balance_usdc` + later `created_at` |
| Order place | exchange-sim | `exchange.orders` | INSERT with `status='filled'` (market) or `'pending'` (limit) |
| Order fill (limit) | exchange-sim | `exchange.orders` | Re-INSERT with `status='filled'`, exec price, `updated_at=now()` |
| Order cancel | exchange-sim | `exchange.orders` | Re-INSERT with `status='canceled'` |
| Order history | exchange-sim | `exchange.orders` | SELECT FINAL WHERE user_id = ? ORDER BY created_at DESC LIMIT N |
| Position upsert | exchange-sim | `exchange.positions` | Re-INSERT with new quantity/avg_price |
| Position read | exchange-sim | `exchange.positions` | SELECT FINAL WHERE user_id = ? AND quantity > 0 |

The frontend (`state`) has no direct ClickHouse connection. All data access goes through REST API calls to `exchange-sim` (`/api/v1/*`) and `fpga-hft-data-generator` (`/api/v1/ohlcv/*`). The tables documented here are the data sources behind those APIs.

---

### Query Performance Notes

#### Design choices that prevent slow queries at scale

**1. ORDER BY prefix alignment**
Every production query filters on the leading column(s) of the ORDER BY key before applying any other predicate. Violating this (e.g. `WHERE symbol = ?` on a table whose key starts with `timestamp`) forces a full-table scan across all granules.

| Table | ORDER BY | Common filter — aligned? |
|---|---|---|
| `historical_trades` | `(symbol, timestamp)` | `WHERE symbol = ? AND timestamp >= ?` — yes |
| `market_ohlc` | `(symbol, candle_time)` | `WHERE symbol = ? AND candle_time >= ?` — yes |
| `exchange.orders` | `(user_id, id)` | `WHERE user_id = ?` — yes |
| `exchange.positions` | `(user_id, symbol)` | `WHERE user_id = ?` — yes |

**2. FINAL keyword — cost and when to use it**
`FINAL` forces read-time deduplication on `ReplacingMergeTree` tables. Without it, stale duplicate rows may be returned before background merges run.

Cost: ClickHouse reads all versions of each row, compares version columns, and discards losers. On a table with millions of rows and high re-insert rate this can be 2–5× slower than a plain SELECT.

Mitigation strategies for large deployments:
- `OPTIMIZE TABLE exchange.orders FINAL` — forces a merge, making subsequent SELECTs cheaper. Run during low-traffic windows.
- Point lookups (`WHERE id = ? LIMIT 1`) have low FINAL overhead because only a few granules are read.
- For admin full-table scans (`list_all_orders`) on large datasets, consider adding a `created_at` range filter to limit the partition scan before FINAL deduplication runs.

**3. Materialized views eliminate GROUP BY on raw ticks**
The 5 OHLCV MVs replace on-the-fly aggregation. Approximate query cost comparison at scale (2 symbols × 30 days × 100 ticks/sec):

| Approach | Rows scanned for 1h of 5m candles |
|---|---|
| GROUP BY on `historical_trades` | ~720,000 raw tick rows |
| SELECT from `historical_trades_mv_5m` | ~24 pre-merged candle rows |

The MV fallback (on-the-fly GROUP BY) is used only when the MV is empty — during the first minutes after deployment before backfill runs.

**4. Batched inserts**
`fpga-hft-data-generator` buffers trade rows and flushes in batches (1,000 rows or 1 second, whichever comes first). ClickHouse is optimised for bulk inserts; single-row inserts at 100/sec would create ~360,000 small parts per hour, overwhelming the background merger and eventually causing `Too many parts` errors.

**5. Partition pruning**
Monthly partitions on `historical_trades` and `exchange.orders` mean queries with a `timestamp >= now() - INTERVAL N MINUTE` condition only open the current (and possibly previous) month's partition files. For the TTL-bounded `historical_trades` table (2-hour window), the entire active dataset fits in one partition.

**6. Potential optimizations for future scale**

| Scenario | Optimization |
|---|---|
| `exchange.users FINAL` slow with many balance updates | Add `OPTIMIZE TABLE exchange.users FINAL` to a nightly cron |
| `list_all_orders` admin scan slow | Add `WHERE created_at >= ?` filter; expose `from_date` query param |
| `historical_trades` hot reads | Add a `skip index` on `price` (`minmax`, granularity 4) for range queries |
| `positions` query slow under many symbols | Already ORDER BY `(user_id, symbol)` — add PREWHERE on `user_id` |
| MV query slow after high-volume insert burst | Run `OPTIMIZE TABLE historical_trades_mv_5m FINAL` to force merge of pending parts |
| Tick volume grows beyond 100/sec | Switch `historical_trades` to `PARTITION BY toYYYYMMDD(timestamp)` for finer partition pruning |

---

## What Has Been Done

- **Authentication:** Login/register with JWT token storage, protected routes, `authFetch` wrapper.
- **Real-time market data:** WebSocket streaming with buffered flush (100ms), partial deep-merge updates, EMA-smoothed telemetry, exponential backoff reconnection, StrictMode-safe closure-local mount tracking.
- **WS connection status badge:** Live header badge shows connected (green), reconnecting (amber), or connecting (red) state driven by Zustand `wsStatus`.
- **Market orders:** Instant execution via exchange-sim API with optimistic UI — blue "Submitting…" overlay appears immediately, resolves to green/red when the API responds.
- **Client-side limit orders:** Stored in localStorage, auto-executed when price crosses limit.
- **Client-side stop-limit orders:** Two-phase execution (stop trigger → limit execute), also persisted.
- **Price alerts:** Auto-fire market orders when price crosses a set target, with deduplication.
- **Bulk order management:** "Cancel All" buttons in AlertsTab clear all pending orders or price alerts for the current symbol. `clearPendingOrders(symbol?)` and `clearPriceAlerts(symbol?)` in the store support both symbol-scoped and global clearing.
- **Level 2 order book:** 5 levels each side, size bars, spread display. Memoized — only re-renders when BBO data changes.
- **Candlestick chart:** Historical OHLCV load + live updates, crosshair tooltip, AbortController-safe fetch, timeframe selector (1m / 5m / 15m / 1h / 1d).
- **P&L panel:** Realized and unrealized breakdown, filterable by order type, open positions table, manual refresh button, error state with retry.
- **Order history panel:** `GET /api/v1/orders?limit=100` — per-order transaction log showing timestamp, symbol, side, order type, quantity, fill price, and status. Filterable by buy/sell. Rendered in a dedicated "Orders" tab inside TradeInterface.
- **Telemetry:** Latency, throughput, error rate with EMA smoothing and color thresholds. Memoized metrics panel.
- **Account fetch error handling:** Inline amber banner with retry button when `/api/v1/account` fails.
- **TradeInterface refactor:** Thin shell + `OrderFormColumn` (shared buy/sell column) + `useOrderForm` hook + `AlertsTab` + `OrderHistoryPanel` components.
- **TypeScript strict compliance:** All WebSocket message fields typed via `WsMessage` interface; `toBN` uses type guards; no `any` casts in the data pipeline; optional fields only written to partials when present.
- **1h/24h change fix:** `change_1h` and `change_24h` carry `skip_serializing_if = "Option::is_none"` in Rust — absent from JSON when not yet polled. Frontend guard changed from `!== undefined` to `!= null` to also block explicit `null`. Together these ensure the store is never overwritten with a spurious zero, and `TopTickerBar` renders `—` until a real polled value arrives.
- **Dark HFT terminal UI:** Tailwind + custom CSS, flash animations on price change, responsive 3-column layout.
- **ClickHouse schema:** Trades, OHLC, metrics tables with compression, TTL, and materialized views (1m + 5m/15m/1h/1d).
- **Dev proxy:** Vite proxies `/api/v1/ohlcv` and `/v1/feed` to the HFT gateway, eliminating browser CORS errors in development.
- **Mock API middleware:** Built into Vite dev server for frontend testing without backends.
- **Production CORS:** `vercel.json` rewrites route REST calls same-origin; WebSocket requires backend `Origin` header acceptance.
- **Content Security Policy:** `vercel.json` injects CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` headers on all responses.
- **Sentry error tracking:** Initialized in `main.tsx`, gated on `VITE_SENTRY_DSN`. 10% transaction sampling, 100% replay on error.
- **Structured logging:** `src/logger.ts` emits pretty logs in dev and JSON in production, replacing bare `console.error`/`console.warn` in critical paths.
- **Chart multi-timeframe backend wired up:** `fpga-hft-data-generator` `api.rs` accepts `?interval=` and routes it to the correct ClickHouse MV in `db.rs`. Fallback on-the-fly aggregation uses the matching truncation function per interval.
- **Order history panel wired up:** `OrderHistoryPanel` calls `GET /api/v1/orders?limit=100`. The exchange-sim `orders.rs` endpoint was already implemented. Frontend interface corrected to match the exchange-sim `Order` model: `id`, `amount`, `status: filled|rejected|pending|canceled`.

---

## Known Gaps

### Missing Features

- **Technical indicators:** No moving averages, RSI, VWAP, or drawing tools. Lightweight-charts supports custom series for this.
- **Rate limit feedback:** No UI warning when the exchange-sim rate limits are hit.
- **Past alerts history:** Fired alerts are removed from state. No log of what triggered and when.
- **Two-factor authentication:** Auth is single-factor only.

### Architecture Risks

- **Client-side order book is a reliability risk.** Limit and stop-limit orders live only in localStorage. Browser storage cleared, a second tab open, or a crash mid-order can cause silent loss or double-execution. This logic belongs in the backend.

### Production Readiness

- No tests (unit, integration, or E2E).
- No CI pipeline or test scripts in `package.json`.
- WebSocket backend must be configured to accept `Origin` from the Vercel app domain (CORS on the WS upgrade handshake).

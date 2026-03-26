# Bull Tech — HFT Trading Platform Technical Proposal

A comprehensive technical reference covering all three services that form the Bull Tech
high-frequency trading dashboard: the synthetic market data generator, the exchange
simulator, and the React frontend. Each section follows a consistent structure — purpose,
architecture, technology choices, security, and known limitations.
<br>

Live Demo: https://bull-tech-dashboard.vercel.app/

The dashboard is fully responsive and optimized for both desktop and mobile viewing.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [FPGA HFT Data Generator](#2-fpga-hft-data-generator)
   - [Overview](#overview-1)
   - [High-Level Architecture](#high-level-architecture)
   - [Configuration](#configuration)
   - [Module Map](#module-map)
   - [Real-Time Broadcast Model & Data Consistency](#real-time-broadcast-model--data-consistency)
   - [Software Methodologies](#software-methodologies)
   - [Technology Choices (FPGA)](#technology-choices-fpga)
   - [Runtime Behaviour Summary](#runtime-behaviour-summary)
   - [What Was Done Well](#what-was-done-well)
   - [Security (FPGA)](#security-fpga)
   - [Known Limitations](#known-limitations)
3. [Exchange Simulator](#3-exchange-simulator)
   - [Overview](#overview-2)
   - [Module Map](#module-map-1)
   - [Real-Time Price Feed & Order Execution Consistency](#real-time-price-feed--order-execution-consistency)
   - [Architecture Decisions](#architecture-decisions)
   - [Request Lifecycles](#request-lifecycles)
   - [API Surface](#api-surface)
   - [Technology Choices (Exchange)](#technology-choices-exchange)
   - [Security (Exchange)](#security-exchange)
   - [Known Limitations](#known-limitations-1)
   - [Dependencies](#dependencies)
4. [React Frontend Dashboard](#4-react-frontend-dashboard)
   - [Tech Stack](#tech-stack)
   - [Technology Choices (Frontend)](#technology-choices-frontend)
   - [Project Structure](#project-structure)
   - [Architecture](#architecture)
   - [Security (Frontend)](#security-frontend)
   - [Production Deployment (Vercel)](#production-deployment-vercel)
   - [What Has Been Done](#what-has-been-done)
   - [Known Limitations](#known-limitations-2)
5. [ClickHouse Database Design](#5-clickhouse-database-design)
   - [Overview](#overview)
   - [Databases and Ownership](#databases-and-ownership)
   - [Table Reference](#table-reference)
   - [DB Interactions — Cross-Service Summary](#db-interactions--cross-service-summary)
   - [Query Performance Notes](#query-performance-notes)
6. [System Architecture Sequence Diagram](#6-system-architecture-sequence-diagram)

---

## 1. System Overview

The Bull Tech HFT dashboard is a full-stack, real-time trading simulation platform composed
of three independently deployable services:

| Service | Language | Port | Role |
|---|---|---|---|
| `fpga-hft-data-generator` | Rust | 8080 | Synthetic market data (GBM), WebSocket tick feed, OHLCV history |
| `exchange-sim` | Rust | 8081 | Authenticated order execution, account state, JWT auth |
| `state` (frontend) | React / TypeScript | — | Browser dashboard: chart, order book, trade forms, P&L |

All three services share a single ClickHouse instance with two databases: `hft_dashboard`
(market data, owned by the generator) and `exchange` (account state, owned by the simulator).
In production, the React app is deployed on Vercel; REST calls are proxied by `vercel.json`
rewrites; the WebSocket feed connects directly to `fpga-hft-data-generator` over `wss://`.

```
User ──── browser (React) ──── Vercel (REST proxy)
                │                      │              │
              WSS               /api/v1/ohlcv   /api/* (exchange)
                │                      │              │
         fpga-hft-data          fpga-hft-data    exchange-sim
           -generator             -generator       :8081
              :8080                  :8080
                │                      │              │
           ClickHouse            ClickHouse      ClickHouse
          hft_dashboard         hft_dashboard     exchange
```

---

## 2. FPGA HFT Data Generator
[Github repository](https://github.com/aleynaalangil/fpga-hft-data-generator)
### Overview

A Rust service that generates synthetic high-frequency trading market data using
Geometric Brownian Motion (GBM) price modelling. It serves configurable crypto
pairs (default: SOL/USDC, BTC/USDC) at a configurable tick rate (default: 100/sec),
persists trades and OHLCV candles to ClickHouse, streams real-time data over
WebSocket, and exposes REST endpoints for snapshots and historical queries.

The name "FPGA" is aspirational — nothing in this codebase runs on FPGA hardware.
The naming reflects the intended downstream use: feeding an FPGA-based exchange
simulator with realistic synthetic market data.

---

### High-Level Architecture

```
Clients (REST / WebSocket)
        |
        v
Actix-web HTTP Server (port configurable, default 8080)
Rate limiter: actix-governor (token bucket, per source IP)
        |
        |-- REST endpoints (api.rs)
        |   /api/v1/health
        |   /api/v1/symbols
        |   /api/v1/tick/{symbol}
        |   /api/v1/bbo/{symbol}
        |   /api/v1/ohlcv/{symbol}?minutes=N&interval=1m|5m|15m|1h|1d
        |   /api/v1/metrics
        |
        |-- WebSocket endpoint (ws.rs)
            /v1/feed  (broadcasts ticks in real time, per symbol)
            Heartbeat: Ping every ping_interval_secs, evict after heartbeat_timeout_secs
            Backpressure: evict clients lagged > 64 messages

Background Tasks (tokio::spawn)
        |
        |-- Tick Generator (every tick_interval_ms)
        |   - measures real wall-clock time per tick
        |   - advances GBM price for each symbol
        |   - records TICK_LATENCY_HISTOGRAM
        |   - updates PRICE_GAUGE
        |   - enqueues TradeRow to DB inserter
        |   - broadcasts MarketDataMessage (with real latency/TPS) to WebSocket
        |   - checks for 1-minute candle closures
        |
        |-- 24h Change Poller (every change_poll_interval_secs)
        |   - queries ClickHouse for oldest price in last 1h / 24h
        |   - writes result into MarketGenerator.change_1h / change_24h
        |
        |-- Graceful Shutdown Handler
            - catches Ctrl+C / SIGINT
            - cancels all tasks via CancellationToken
            - waits for DB inserter to drain before exit

Shared State
        DashMap<String, MarketGenerator>   -- lock-free, one entry per symbol
        broadcast::Sender<String>          -- WebSocket fan-out (capacity: ws_broadcast_capacity)
        mpsc::Sender<InserterPayload>      -- DB insert queue (capacity: db_insert_buffer_size)

Persistence (ClickHouse)
        hft_dashboard.historical_trades    -- raw tick rows (MergeTree, 2h TTL)
        hft_dashboard.market_ohlc          -- 1-minute OHLCV (ReplacingMergeTree, 90d TTL)
```

---

### Configuration

All runtime parameters are read from `config.toml` at startup (optional file,
hard-coded defaults apply when absent). The `PORT` environment variable overrides
`config.toml`. ClickHouse credentials are env-var only.

**`config.toml` / `src/config.rs`**

| Key | Default | Description |
|---|---|---|
| `port` | 8080 | HTTP listen port (also env `PORT`) |
| `tick_interval_ms` | 10 | Tick generation interval (10ms = 100 ticks/sec) |
| `db_flush_interval_secs` | 1 | Inserter timer flush interval |
| `db_insert_buffer_size` | 1000 | Trade buffer size before forced flush |
| `tick_history_size` | 1200 | Ring-buffer depth per symbol |
| `ws_broadcast_capacity` | 128 | WebSocket broadcast channel capacity |
| `change_poll_interval_secs` | 5 | 1h/24h change poll interval |
| `ws_heartbeat_timeout_secs` | 60 | Evict WebSocket client after this many idle seconds |
| `ws_ping_interval_secs` | 20 | Send Ping to idle WebSocket clients this often |
| `rate_limit_per_second` | 100 | REST API sustained requests per IP |
| `rate_limit_burst` | 50 | REST API burst allowance |
| `[[symbols]]` | SOL/USDC, BTC/USDC | List of trading pairs with GBM params |

Per-symbol GBM parameters in `config.toml`:

| Symbol | `initial_price` | `drift` | `volatility` | `spread` |
|---|---|---|---|---|
| SOL/USDC | 150.0 | 0.0001 | 0.002 | 0.01 |
| BTC/USDC | 65,000.0 | 0.0001 | 0.001 | 10.0 |

**ClickHouse environment variables:**

| Variable | Default |
|---|---|
| `CLICKHOUSE_URL` | `http://localhost:8123` |
| `CLICKHOUSE_USER` | `inserter_user` |
| `CLICKHOUSE_PASSWORD` | `inserter_pass` |
| `CLICKHOUSE_DB` | `hft_dashboard` |

A warning is logged at startup if the default credentials are detected.

---

### Module Map

#### `main.rs` — Bootstrap and Orchestration

Loads `AppConfig`, initialises one `MarketGenerator` per configured symbol,
spawns all background tasks, wires up Actix with CORS, rate limiting, and
two HTTP workers, and manages lifecycle via `CancellationToken`.

**Notable decisions**
- Single tick-generation loop over all symbols rather than one task per symbol.
  Correct for a small symbol count — task-switching cost outweighs parallelism
  gain. A comment in the code flags that 500+ symbols would need a different design.
- Symbol state lives in a `DashMap` (lock-free concurrent HashMap) so REST
  handlers can read state without holding a mutex across await points.
- CORS is fully open (`allow_any_origin`). Appropriate for a local/internal
  simulator, not for internet-facing deployment.
- Real tick latency is measured per-symbol via `Instant` and passed directly
  into `to_ws_message()` and `TICK_LATENCY_HISTOGRAM`.
- Rate limiter (`actix-governor`) wraps the entire App at the middleware level.

---

#### `config.rs` — Application Configuration

Defines `AppConfig` and `SymbolConfig`. `AppConfig::load()` reads `config.toml`
using the `toml` crate, then applies `PORT` env var override. Falls back to
hard-coded defaults if no file exists.

The `[[symbols]]` array in `config.toml` drives which trading pairs are
initialised — adding a new pair requires only a new TOML block, no code change.

---

#### `models.rs` — Data Types

Defines the serialisable structs that cross module boundaries.

**`MarketTick`** — a single trade event with symbol, side, price, amount,
timestamp (RFC3339 microsecond), UUID order id, and random trader id.

**`OrderBookLevel` / `BboSnapshot`** — best bid/offer with a 20-level ladder.
Prices and sizes are stored as fixed-point `u64` scaled by 10^8. This matches
standard HFT practice: integer comparison is faster than floating-point and avoids
rounding drift across aggregations.

**`OhlcvBar`** — 1-minute candle with open/high/low/close/volume, all `Decimal`.

**`OhlcvRow`** — ClickHouse wire type for `market_ohlc`. Extends `OhlcvBar` with
`change_1h` and `change_24h` (`Decimal64(8)`). At candle close, the generator's
live change percentages are stamped onto the row via `OhlcvRow::with_changes()`.

**`MarketDataMessage`** — the WebSocket envelope. Bundles tick, BBO, current
candle, telemetry, and change percentages into one JSON payload. Uses `f64` for
JSON compatibility (JavaScript has no native Decimal type). `change_1h` and
`change_24h` carry `#[serde(skip_serializing_if = "Option::is_none")]` — they are
absent from the JSON entirely when the generator has no polled value yet, so the
frontend never receives a spurious `null` that would overwrite a cached value.

**`SystemTelemetry`** — real measured latency (`actual_latency_ms` from the tick
loop) and nominal TPS derived from `tick_interval_ms`. The `error_rate` field is
zero — DB errors are tracked separately via `DB_ERROR_COUNTER` in Prometheus.

---

#### `generator.rs` — Price Simulation Engine

**Geometric Brownian Motion** is the standard stochastic model for equity/crypto
prices. The discrete update rule:

```
S_t+1 = S_t × (1 + μ·dt + σ·√dt · Z)

where:
  μ   = drift (configurable per symbol)
  σ   = volatility (configurable per symbol)
  dt  = 0.01 (fixed time step)
  Z   ~ N(0,1) via rand_distr::Normal (true Gaussian, unbounded tails)
```

`rand_distr::Normal` replaced the previous sum-of-12-uniforms approximation.
That method was bounded at ±6σ; the true Gaussian correctly represents
multi-sigma events that occur regularly in crypto markets.

**`advance()`** — computes the next GBM step, appends to the ring buffer
(`VecDeque`, max `tick_history_size` elements), updates the current candle,
returns a `MarketTick`.

**`current_bbo()`** — builds the order book snapshot:
- Level spacing: cumulative geometric steps (~2% per level from mid).
- Level sizes: sampled from `LogNormal(μ=4, σ=1.2)`, giving a heavy-tailed
  size distribution representative of real limit order books.
- Tick size scales with spread (`spread / 20`) so BTC and SOL get
  appropriately different granularity.

**`check_candle_closure()`** — detects minute boundary by comparing the first
16 characters ("YYYY-MM-DDTHH:MM") of the current and last tick timestamps.
Returns the completed candle when the minute changes.

**`build_ohlcv(minutes)`** — groups the in-memory ring buffer into 1-minute
candles. Used as fallback when ClickHouse has no data yet.

**`to_ws_message(actual_latency_ms, actual_tps)`** — assembles the WebSocket
payload using real measured values for latency and throughput. No random
simulation of telemetry.

---

#### `db.rs` — ClickHouse Integration and Metrics

**Prometheus metrics** — seven singletons registered in a global `Registry`:

| Metric | Type | Labels | What it measures |
|---|---|---|---|
| `hft_ticks_total` | IntCounter | — | Total ticks generated since start |
| `hft_asset_price` | GaugeVec | `symbol` | Current price per symbol |
| `hft_tick_latency_ms` | Histogram | — | Actual tick generation wall time |
| `hft_ws_clients` | Gauge | — | Active WebSocket connections |
| `hft_ws_lagged_total` | IntCounter | — | Broadcast lag events |
| `hft_db_errors_total` | IntCounterVec | `operation` | DB errors by operation |
| `hft_db_flush_duration_ms` | Histogram | — | ClickHouse batch flush time |

**Custom serde modules for ClickHouse binary protocol:**

- `ch_decimal` — serialises `Decimal` to `i64` scaled by 10^8 (matching
  `Decimal64(8)`) and deserialises back. Avoids floating-point loss.
- `ch_datetime` — serialises RFC3339 timestamps to microseconds-since-epoch
  (`i64`). Deserialisation auto-detects seconds vs microseconds based on
  magnitude (values < 1e10 are treated as seconds).

**`run_unified_lazy_inserter(rx, client, flush_secs, buffer_size)`** — receives
`InserterPayload` enums, buffers trade rows up to `buffer_size`, and flushes on
either the buffer limit or a `flush_secs` timer. Both flush functions are
instrumented with `DB_FLUSH_DURATION` timers and increment `DB_ERROR_COUNTER` on
failure.

**Historical queries:**
- `poll_1h_change` — price at/before 1h ago from `historical_trades` (`ORDER BY timestamp DESC LIMIT 1` on rows `<= now() - 1h`). Uses a local single-field `PriceRow` struct to avoid deserialising the full `TradeRow`. Returns `None` if no data older than 1h exists yet. `historical_trades` has a 2h TTL so 1h lookback is safe.
- `poll_24h_change` — price at/before 24h ago from `market_ohlc FINAL` (`close` column, `ORDER BY candle_time DESC LIMIT 1` on rows `<= now() - 1 day`). Uses `market_ohlc` (90-day TTL) because `historical_trades` only retains 2h of data. Returns `None` until 24h of candle history exists.
- `get_historical_ohlc(client, symbol, minutes, interval)` — routes to the correct
  ClickHouse data source based on `interval`:
  - `1m` → `market_ohlc` (pre-aggregated 1m candles) → fallback: `toStartOfMinute` GROUP BY on raw trades
  - `5m` → `historical_trades_mv_5m` (AggregatingMergeTree) → fallback: `toStartOfInterval(..., INTERVAL 5 MINUTE)` GROUP BY
  - `15m` → `historical_trades_mv_15m` → fallback: `toStartOfInterval(..., INTERVAL 15 MINUTE)` GROUP BY
  - `1h` → `historical_trades_mv_1h` → fallback: `toStartOfHour` GROUP BY
  - `1d` → `historical_trades_mv_1d` → fallback: `toStartOfDay` GROUP BY

  MV queries use `*Merge` aggregate functions (`argMinMerge`, `maxMerge`, `minMerge`, `argMaxMerge`, `sumMerge`) to finalise the stored `*State` values.
- `backfill_missing_candles` — on startup, fills `market_ohlc` for any minute
  in the last 2 hours not already present.

---

#### `api.rs` — REST Handlers

All handlers receive an `Arc`-wrapped `DashMap` and a ClickHouse `Client` via
Actix's `web::Data` extractor.

**Symbol URL format** — URL uses dashes (SOL-USDC), internal map uses slashes
(SOL/USDC). `raw_symbol_to_symbol()` converts between them.

**OHLCV query parameters:**

| Parameter | Default | Constraint | Description |
|---|---|---|---|
| `minutes` | 60 | clamped [1, 10080] | Time window to return |
| `interval` | `1m` | `1m` / `5m` / `15m` / `1h` / `1d` | Candle resolution — routes to the appropriate ClickHouse MV |

**Error model** — `ErrorResponse { error: String }` JSON for all non-200 responses.

---

#### `ws.rs` — WebSocket Handler

Uses `actix-ws` for the protocol upgrade. Each client connection receives its own
`tokio::select!` loop over three branches.

1. **Heartbeat timer** — ticks every `ping_interval / 2` seconds (capped at 5s
   minimum). On each tick:
   - If `elapsed > heartbeat_timeout_secs`: forcibly close the session and break.
   - If `elapsed > ping_interval_secs`: send a `Ping` frame.
   - `last_heartbeat` is only reset on `Pong` receipt, not on ping-sent. This
     ensures a client that accepts pings but never responds will still be evicted.

2. **Incoming client messages** — handles `Pong` (resets `last_heartbeat`),
   `Close` (clean disconnect), and ignores everything else.

3. **Broadcast channel receiver** — receives pre-serialised JSON strings and
   forwards as `Text` frames. On `Lagged(count)`:
   - Increments `WS_LAGGED_COUNTER`.
   - If `count > 64` (half broadcast channel capacity), evicts the client.

`WS_CLIENT_GAUGE` is incremented at connection start and decremented at every
exit path via a labelled loop.

---

### Real-Time Broadcast Model & Data Consistency

**End-to-end tick pipeline:**

```
GBM advance() — every 10ms per symbol
  └─ MarketTick { price, bbo, ohlc, telemetry, change_1h, change_24h }
       └─ to_ws_message() → JSON string  (serialised ONCE)
            └─ broadcast::Sender<String>.send(json)
                 └─ tokio broadcast channel (capacity: ws_broadcast_capacity)
                      └─ each WS handler's select! branch receives the same Arc<str>
                           └─ session.text(json) → WebSocket frame to client
```

**Why pre-serialise the JSON once.** The broadcast channel carries `String` (the serialised payload), not `MarketDataMessage`. If each handler serialised independently, N clients would each call `serde_json::to_string` on the same data — O(N) CPU work per tick. Pre-serialising in the tick loop makes broadcast O(1) for serialisation regardless of client count, with O(N) only for the frame copy into each client's socket buffer.

**Backpressure: lagged client eviction.** The `tokio::sync::broadcast` channel has a fixed capacity (`ws_broadcast_capacity`, default 128). When a slow client falls 64 messages behind (half capacity), its `recv()` returns `Lagged(count)`. The handler evicts the client rather than blocking the channel or letting it accumulate unbounded lag.

**Heartbeat-based dead client detection.** The TCP stack does not reliably signal when a client silently disappears (e.g. network cut, browser tab killed). The heartbeat loop sends `Ping` frames every `ping_interval_secs` and tracks the last `Pong` receipt time. If `elapsed > heartbeat_timeout_secs` the session is forcibly closed.

**Message ordering guarantee.** `tokio::sync::broadcast` is a MPMC channel — all receivers see messages in insertion order. Since ticks are generated in a single loop (not parallel tasks), the tick sequence received by any client is the same total order as generated.

**What is not guaranteed:**
- **Exactly-once delivery** — a client that reconnects does not receive ticks missed during the disconnect.
- **Synchronisation across clients** — two clients may be at different positions in the broadcast channel at any moment.
- **Consistency with ClickHouse** — ticks are broadcast before the corresponding `TradeRow` is flushed to ClickHouse (the lazy inserter has up to 1s delay).

---

### Software Methodologies

**Actor-like message passing** — the DB inserter is an isolated task that owns
its buffers and communicates only through channels.

**Cancellation-based shutdown** — `tokio_util::sync::CancellationToken` propagates
shutdown intent to all tasks cleanly.

**Layered fallbacks** — OHLCV endpoint: ClickHouse MV → on-the-fly GROUP BY from raw trades → in-memory ring buffer.

**Fixed-point arithmetic for prices** — `rust_decimal::Decimal` for business logic,
`u64` fixed-point (scale 10^8) for the order book. Avoids floating-point rounding
in price comparisons.

**Lazy batch insertion** — trades buffered and flushed in batches. ClickHouse is
optimised for bulk inserts; single-row inserts at 100/sec would cause excessive
merge pressure.

**Lock-free shared state** — `DashMap` (shard-based) instead of `Mutex<HashMap>`
allows REST handlers to read symbol state concurrently.

**Measured telemetry** — tick latency is measured per-symbol via `Instant` and
both recorded in Prometheus histograms and forwarded directly in the WebSocket
payload. No simulated values.

**Token-bucket rate limiting** — `actix-governor` wraps the Actix App at the
middleware level, providing per-IP rate limiting with a configurable sustained rate
and burst allowance.

---

### Technology Choices (FPGA)

#### Rust

**Performance:** Rust compiles to native machine code with no garbage collector. GC pauses are the main source of unpredictable latency in Go, JVM, and Node.js services. At 100 ticks/sec per symbol, a 10ms GC pause doubles the tick interval for its duration and produces visible chart gaps. Rust's ownership model eliminates GC entirely — latency is bounded by I/O, not the runtime.

**Scalability:** Zero-cost abstractions mean adding features (new metrics, more symbols, additional WS clients) does not introduce hidden runtime overhead. `async/await` on top of `tokio` scales to thousands of concurrent WebSocket connections on a single thread pool with no per-connection stack allocation.

**Maintainability:** The borrow checker prevents data races at compile time — a critical property for a service that shares price state across a tick generator task, multiple REST handler threads, and WebSocket broadcast. Race conditions that would only appear under load in Go or C++ are compile errors in Rust.

**Alternatives considered:** Go — simpler concurrency model, faster compile times, GC pauses are a drawback. Node.js — single-threaded event loop, GC, not suitable for CPU-bound GBM computation at this frequency. Python — too slow for 100 ticks/sec without native extensions.

---

#### actix-web

**Performance:** Consistently ranks in the top 3 on TechEmpower Framework Benchmarks across plaintext and JSON serialisation categories. Its actor model dispatches requests to a configurable number of OS threads (`HttpServer::workers`), each running a `tokio` event loop — full CPU utilisation with no lock contention on the hot path.

**Scalability:** The `web::Data<T>` extractor injects shared state (DashMap, ClickHouse client) into handlers without copying. Middleware (CORS, rate limiting via `actix-governor`) composes without modifying handler signatures.

**Maintainability:** Handler functions are plain `async fn` returning `impl Responder`. Error handling through `AppError`-style enums maps cleanly to HTTP status codes.

**Alternatives considered:** Axum — similar performance, slightly more ergonomic extractor system, but less mature ecosystem at project start. Warp — combinator style is harder to read for complex route trees. Rocket — async support was added later and is less battle-tested.

---

#### tokio

**Performance:** Multi-threaded work-stealing scheduler maximises CPU utilisation across all cores. `tokio::select!` allows a single task to wait on multiple futures simultaneously — the WebSocket handler, tick timer, and DB flush timer all run in one `select!` loop with no thread-per-connection overhead.

**Scalability:** The async model handles thousands of concurrent WebSocket clients on a fixed thread pool. `tokio::sync::broadcast` provides efficient one-to-many fan-out without per-subscriber locking.

**Maintainability:** `tokio_util::CancellationToken` propagates shutdown intent to all tasks cleanly. `mpsc` channels decouple the tick generator from the DB inserter. `tokio::time::interval` provides precise periodic timers without busy-waiting.

**Alternatives considered:** `async-std` — compatible API but smaller ecosystem and fewer production deployments. Blocking threads — simpler but cannot handle 1000+ concurrent WS clients without exhausting the thread pool.

---

#### ClickHouse

**Performance:** Columnar storage reads only the columns referenced in a query. ZSTD + DoubleDelta compression reduces I/O by 80–90% for time-series data. Vectorised query execution processes data in 8192-row granules using SIMD instructions.

**Scalability:** Designed for insert throughput at millions of rows/sec. The lazy inserter pattern (batch flush every 1s or 1000 rows) aligns with ClickHouse's preferred write pattern. `AggregatingMergeTree` materialized views incrementally maintain OHLCV aggregates as data arrives, eliminating full-table GROUP BY scans at query time.

**Maintainability:** The schema is defined in a single SQL file and applied once. Adding a new timeframe MV requires one `CREATE MATERIALIZED VIEW` statement.

**Alternatives considered:** PostgreSQL with TimescaleDB — MVCC row storage is inefficient for append-only time-series. InfluxDB — purpose-built time-series but lacks SQL and JOIN support. Redis — in-memory only, not suitable for 30-day historical retention.

---

#### DashMap

**Performance:** Shard-based concurrent HashMap. Reads from the tick generator, REST handlers, and WebSocket broadcast path happen simultaneously — a `Mutex<HashMap>` would serialize all of these. DashMap shards the lock space so concurrent reads to different symbol buckets never contend.

**Scalability:** At 2 symbols the sharding is overkill, but the design is correct for 50+ symbols with no code change. Lock-free reads are sub-microsecond.

**Alternatives considered:** `RwLock<HashMap>` — allows concurrent reads but blocks all readers during a write. At 100 writes/sec (one per tick) with many concurrent REST handlers this creates measurable read latency spikes.

---

#### rust_decimal

**Performance:** Fixed-point arithmetic is faster than arbitrary-precision libraries for the decimal scales used here (8 decimal places). Operations stay within 128-bit integers — no heap allocation, no big-integer arithmetic.

**Scalability:** `Decimal64(8)` in ClickHouse maps directly to Rust `Decimal` with scale 8. The custom `ch_decimal` serde module serializes to/from `i64` (ClickHouse binary wire format) without intermediate string conversion.

**Alternatives considered:** `f64` — fast, but 64-bit IEEE 754 cannot represent many decimal fractions exactly. Price drift accumulates rounding error across thousands of GBM steps.

---

#### Prometheus + lazy_static metrics

**Performance:** Prometheus counters and gauges are atomic integers/floats — increment is a single `fetch_add` instruction. Histograms use pre-bucketed atomic arrays.

**Scalability:** The pull model (Prometheus scrapes on its own schedule) decouples metric collection from the application write path. Adding new metrics is a single `lazy_static!` declaration and registration call.

**Alternatives considered:** Custom JSON `/metrics` endpoint — no ecosystem integration. StatsD/Datadog — push model, requires a sidecar agent. OpenTelemetry — more powerful but significantly more complex to configure for a single-service deployment.

---

### Runtime Behaviour Summary

| Property | Default | Configurable |
|---|---|---|
| Tick rate | 100/sec (10ms) | Yes — `tick_interval_ms` |
| Symbols | 2 (SOL/USDC, BTC/USDC) | Yes — `[[symbols]]` in config.toml |
| Tick history per symbol | 1,200 (ring buffer) | Yes — `tick_history_size` |
| Candle resolution | 1 minute | No |
| Order book depth | 20 levels (bid + ask) | No |
| DB flush interval | 1s or 1,000 trades | Yes — `db_flush_interval_secs`, `db_insert_buffer_size` |
| WebSocket broadcast capacity | 128 | Yes — `ws_broadcast_capacity` |
| WS heartbeat timeout | 60s | Yes — `ws_heartbeat_timeout_secs` |
| WS ping interval | 20s | Yes — `ws_ping_interval_secs` |
| REST rate limit | 100 req/s, burst 50 | Yes — `rate_limit_per_second`, `rate_limit_burst` |
| 24h change poll interval | 5s | Yes — `change_poll_interval_secs` |
| HTTP port | 8080 | Yes — `port` / env `PORT` |

---

### What Was Done Well

- **GBM with true Gaussian tails** — `rand_distr::Normal` gives correct unbounded N(0,1) sampling.
- **Configurable everything** — `config.toml` + `AppConfig` removes all hardcoded parameters; new symbols require a TOML block, not a code change.
- **Realistic order book** — log-normal sizes + geometric level spacing replace the previous uniform/anti-realistic structure.
- **Real telemetry** — latency and TPS in WebSocket messages are measured, not random fiction.
- **Comprehensive Prometheus coverage** — 7 metrics covering tick latency, WS client count, lag events, DB errors, and flush duration.
- **Heartbeat enforced correctly** — `last_heartbeat` only resets on Pong; stale clients are evicted after a configurable timeout.
- **Lagged client eviction** — clients exceeding half the broadcast channel capacity are disconnected rather than silently accumulating lag.
- **12 unit tests** — covering fixed-point precision, decimal round-trips, datetime round-trips, GBM price floor, BBO structure, candle logic, and ring buffer limits.
- **Separation of concerns** — models, config, generator, DB, API, and WebSocket are distinct modules with narrow interfaces.
- **Graceful shutdown** — channel drain prevents data loss on Ctrl+C.
- **Docker multi-stage build** — Debian slim runtime image.
- **Backfill on startup** — candle history survives service restarts.
- **Pre-serialised WebSocket broadcast** — avoids per-client JSON serialisation.

---

### Security (FPGA)

#### Authentication & Access Control

**This service has no user authentication.** The `/v1/feed` WebSocket endpoint and all REST endpoints are publicly accessible. This is an intentional design decision for a synthetic market data feed:

- The data is entirely synthetic — no real financial data, no user data, no account information is served
- The intended consumers are the exchange-sim backend (internal) and the frontend dashboard (via Vercel rewrite)
- In production, access should be restricted by network policy rather than application-level authentication

**Rate limiting** is the only access control mechanism implemented. `actix-governor` enforces a token bucket per source IP:

| Parameter | Default | Config key |
|---|---|---|
| Sustained rate | 100 req/s | `rate_limit_per_second` |
| Burst allowance | 50 requests | `rate_limit_burst` |

WebSocket connections are rate-limited only at the initial HTTP upgrade request — subsequent frames are not rate-limited once the connection is established.

#### ClickHouse Credential Security

**Principle of least privilege:** The `inserter_user` ClickHouse account has only `INSERT` and `SELECT` on `hft_dashboard.*`. It cannot `DROP` tables, modify schemas, or read system tables.

| Variable | Default | Risk if default used |
|---|---|---|
| `CLICKHOUSE_USER` | `inserter_user` | None (low-privilege account) |
| `CLICKHOUSE_PASSWORD` | `inserter_pass` | Known default, must be changed before network exposure |
| `CLICKHOUSE_URL` | `http://localhost:8123` | Plain HTTP; credentials travel in cleartext |

#### Sensitive Data Exposure

**No user data served.** All data generated and served by this service is synthetic market data. There are no real user accounts, no real financial positions, and no PII anywhere in the data pipeline.

**Prometheus metrics endpoint** (`/api/v1/metrics`) exposes operational metrics. In production, this endpoint should be restricted to the internal monitoring network.

#### Secure Communication

**Frontend → fpga-hft-data-generator (REST):** In production, Vercel rewrites to this service over HTTPS.

**Frontend → fpga-hft-data-generator (WebSocket):** The WS connection from the browser is direct (`wss://`). The service must present a valid TLS certificate for the browser to allow a `wss://` upgrade.

**exchange-sim → fpga-hft-data-generator:** Internal WebSocket connection on Docker Compose private network.

#### Security Gaps (Production Hardening Required)

| Gap | Risk | Recommended fix |
|---|---|---|
| No authentication on API | Anyone with network access can read market data and metrics | Restrict by network policy (VPC, private subnet) or add API key check |
| CORS fully open (`allow_any_origin`) | Any web origin can make cross-origin API requests | Restrict to Vercel app domain and internal origins |
| Plain HTTP to ClickHouse | Credentials in cleartext on network | Enable ClickHouse TLS; or use Unix socket on single-host setups |
| Metrics endpoint publicly accessible | Exposes operational internals | Move behind internal network or add IP allowlist middleware |
| No WS authentication | Any client can connect and consume the full tick stream | Add token-based WS handshake query param or subprotocol auth |

---

### Known Limitations

- **BBO is simulated, not microstructure-driven** — log-normal sizes and geometric level spacing are an improvement but not a real limit order book model. A Hawkes process with price-level clustering would be the correct next step.
- **No integration tests** — unit tests cover pure functions only.
- **`error_rate` in telemetry is hardcoded to 0.0** — the real figure is available at `/api/v1/metrics`.
- **Backfill window is hardcoded to 2 hours** — `backfill_missing_candles` always uses `INTERVAL 2 HOUR`. It should be a `config.toml` parameter.
- **CORS is fully open** — any internet-facing deployment must restrict this to known origins.

---

## 3. Exchange Simulator
[Github repository](https://github.com/aleynaalangil/exchange-sim)
### Overview

`exchange-sim` is a simulated crypto exchange backend. It accepts authenticated trade orders from users, executes them at live market prices sourced from the `fpga-hft-data-generator` service, and persists all account state (users, balances, orders, positions) in ClickHouse. It is intentionally a single-process, stateless HTTP service — no message broker, no cache server.

---

### Module Map

```
src/
├── main.rs        — Server bootstrap, route registration, AppState
├── config.rs      — Environment variable loading (including SYMBOLS)
├── models.rs      — Domain types: User, Order, Position, enums, request/response shapes
├── error.rs       — Unified AppError enum → HTTP response mapping
├── auth.rs        — JWT creation, verification, jti-based revocation
├── db.rs          — All ClickHouse queries (users, orders, positions)
├── engine.rs      — Order execution logic (market + limit, position math)
├── order_book.rs  — In-memory limit order book + background matcher task
├── ws_client.rs   — WebSocket consumer that keeps the live price cache warm
└── api/
    ├── mod.rs
    ├── auth.rs    — POST /auth/login, POST /auth/register, POST /auth/logout
    ├── account.rs — GET /account
    ├── orders.rs  — POST /orders, GET /orders, DELETE /orders/{id}
    └── admin.rs   — Admin-only user/balance/order management
```

---

### Real-Time Price Feed & Order Execution Consistency

#### How the price feed works

`ws_client.rs` runs a background `tokio` task that maintains a persistent WebSocket connection to `fpga-hft-data-generator /v1/feed`. Each `MarketDataMessage` received updates the in-process `DashMap<String, f64>` price cache atomically:

```
fpga-hft-data-generator (every 10ms)
  └─ broadcast tick → WebSocket frame
       └─ ws_client.rs (tokio task)
            └─ parse price from MarketDataMessage
                 └─ prices.insert(symbol, price)  ← DashMap, lock-free write

POST /api/v1/orders handler (any thread)
  └─ prices.get(&symbol)  ← DashMap, lock-free read, sub-microsecond
       └─ use exec_price for balance check and order record
```

The DashMap decouples the write frequency (100/sec from the WS feed) from the read frequency (one read per order). Order handlers never wait for a price update and are never blocked by a price write.

#### Consistency guarantees for order execution

**Price freshness.** The price used for execution is at most 10ms stale (one tick interval). For a simulated exchange this is acceptable.

**Per-user atomicity.** Each order handler acquires the user's `Mutex` before reading the balance and holds it through both ClickHouse writes (order record + balance update). This prevents two concurrent orders from the same user both passing the balance check against the same pre-order balance.

**What is not atomic.** The two ClickHouse writes (`insert_order` and `update_user_balance`) are separate HTTP requests to ClickHouse. There is no distributed transaction. A process crash between the two writes would leave the order recorded but the balance not decremented. The per-user Mutex prevents concurrent races but not crash-induced inconsistency.

**Reconnection behaviour.** If the WebSocket connection to `fpga-hft-data-generator` drops, the price cache retains the last known value for each symbol. Incoming orders during a reconnect window will execute against a stale price.

**State read at order time vs display time.** The frontend reads prices from its own Zustand store (populated by its own WebSocket connection). The exchange-sim reads prices from its own DashMap (populated by its own WebSocket connection). Both connect to the same `fpga-hft-data-generator` feed — the price displayed to the user and the price used for execution are derived from the same source.

---

### Architecture Decisions

#### 1. In-process price cache (DashMap) instead of Redis

The live price cache is a `DashMap<String, f64>` held in memory within the exchange-sim process, fed by a background Tokio task that consumes the HFT generator's WebSocket feed.

**Why not Redis?**
- There is exactly one instance of exchange-sim. A shared external cache adds a network hop for every order with zero benefit in a single-node deployment.
- `DashMap` is a lock-free concurrent hashmap. Price reads during order execution are contention-free and sub-microsecond.
- The data is ephemeral by nature — if the process restarts it reconnects to the WebSocket and the cache re-warms within milliseconds.
- Redis would only be justified when scaling exchange-sim horizontally.

#### 2. JWT auth with in-memory revocation (jti blocklist)

Tokens encode `user_id`, `role`, and a unique `jti` (JWT ID). Every request is self-contained — the handler verifies the token's HMAC signature and expiry, then checks the jti against an in-memory `DashMap<jti, expiry>`.

`POST /auth/logout` inserts the token's jti into the blocklist. A background task purges expired entries every 5 minutes to bound memory growth.

**Tradeoff vs Redis:** The blocklist is in-process only. If the service restarts, revoked tokens become valid again until their natural expiry.

#### 3. ClickHouse for all persistent state

ClickHouse is primarily an OLAP / time-series database, not a transactional OLTP store. It was chosen because the sibling service (`fpga-hft-data-generator`) already uses it, and keeping a single infrastructure dependency was a deliberate simplicity trade-off.

**Consequences of this choice:**

| Pattern | How it is handled in code |
|---|---|
| "Upsert" a user balance | Re-insert a new row with a later `created_at` + `ReplacingMergeTree` deduplicates by `id` on merge. All queries use `FINAL`. |
| "Upsert" a position | Same pattern — `ReplacingMergeTree` on `(user_id, symbol)`, queries use `FINAL`. |
| "Update" an order status | `ReplacingMergeTree(updated_at)`. Re-inserting with a newer `updated_at` causes the new row to win at query time (FINAL). |
| Uniqueness constraint on username | No DB-level unique index — enforced by a `tokio::Mutex` in `AppState` that serialises the check-then-insert. |

#### 4. Per-user mutex for order serialisation

`AppState` holds `user_locks: DashMap<user_id, Arc<Mutex<()>>>`. The `place_order` and `cancel_order` handlers acquire the per-user lock before reading the user from DB, hold it through both ClickHouse writes, and release it after.

This prevents concurrent orders from the same user both passing the balance check. It does not make the two ClickHouse writes fully atomic.

#### 5. Symbols loaded from config (SYMBOLS env var)

Trading pairs are no longer hard-coded. `Config.symbols` is populated from the `SYMBOLS` environment variable (comma-separated, e.g. `SOL/USDC,BTC/USDC`). The engine accepts both slash and dash forms (`SOL-USDC` or `SOL/USDC`). Adding a new symbol requires only an env var change and restart — no code change.

#### 6. In-memory limit order book with background matcher

`OrderBook` is an `Arc<RwLock<Vec<PendingLimitOrder>>>` shared between request handlers and a background Tokio task (`order_book::run_matcher`).

**Placement flow:**
- Funds are locked immediately: USDC for buy limits (`limit_price × amount`), position quantity for sell limits.
- A `PendingLimitOrder` is added to the book; the order is persisted as `Pending` in ClickHouse.

**Matching flow (every 500ms):**
- The matcher calls `drain_fillable`, which atomically removes all fillable orders from the book in a single write-lock pass.
- For each fill: position (buys) or USDC (sells) is credited; excess locked USDC is refunded; the order row is re-inserted with `status = Filled`.

**Cancellation flow (`DELETE /orders/{id}`):**
- The handler acquires the per-user lock to prevent a race with the background matcher.
- `order_book.remove` removes the order from the book and returns the locked funds metadata.
- Locked funds are returned before the order is marked `Canceled` in ClickHouse.

---

### Request Lifecycles

#### Place Market Order

```
POST /api/v1/orders  { symbol, side, amount, order_type: "market" }
  │
  ├─ extract_claims()           — verify JWT signature + expiry + jti not revoked
  ├─ get_user_lock(user_id)     — acquire per-user Mutex
  ├─ db::get_user_by_id()       — load current balance (FINAL)
  ├─ engine.place_order()
  │   ├─ normalize_symbol()     — accept "SOL-USDC" or "SOL/USDC"
  │   ├─ prices.get(&symbol)    — read live price from DashMap (lock-free)
  │   ├─ balance / position check → reject if insufficient
  │   ├─ mutate user.balance_usdc in memory
  │   ├─ pub_update_position_buy/sell()
  │   │   ├─ db::get_positions_for_user()
  │   │   └─ db::upsert_position()
  │   ├─ db::insert_order()     — persist order record (status: filled)
  │   └─ db::update_user_balance()
  ├─ release per-user Mutex
  └─ return 201 Order JSON
```

#### Place Limit Order

```
POST /api/v1/orders  { symbol, side, amount, order_type: "limit", limit_price }
  │
  ├─ extract_claims() + per-user lock
  ├─ db::get_user_by_id()
  ├─ engine.execute_limit()
  │   ├─ Buy: deduct limit_price × amount from balance (lock USDC)
  │   │  Sell: deduct position quantity (lock asset)
  │   ├─ db::insert_order()     — status: pending, price: 0
  │   └─ db::update_user_balance()
  ├─ order_book.add(PendingLimitOrder)
  ├─ release per-user Mutex
  └─ return 200 Order JSON (status: pending)

  [background — every 500ms]
  order_book::run_matcher()
    ├─ drain_fillable(&prices)  — atomically remove eligible orders
    └─ for each fillable order:
        ├─ acquire per-user lock
        ├─ db::update_order_fill()  — re-insert with status: filled, exec_price
        ├─ credit position (buy) or USDC (sell)
        ├─ refund excess locked USDC (buy only)
        └─ release per-user lock
```

---

### API Surface

#### Public (no auth)
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | Liveness check, returns live symbol count |
| GET | `/api/v1/symbols` | List supported trading pairs (from SYMBOLS env var) |
| GET | `/api/v1/prices` | Current price snapshot from HFT cache |

#### Authenticated (Bearer JWT)
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Create trader account (10,000 USDC starting balance) |
| POST | `/api/v1/auth/login` | Bcrypt password check → JWT with jti |
| POST | `/api/v1/auth/logout` | Revoke token (add jti to blocklist) |
| GET | `/api/v1/account` | Balance + open positions |
| POST | `/api/v1/orders` | Place market or limit order |
| GET | `/api/v1/orders` | Order history (default limit 50, max 500) |
| DELETE | `/api/v1/orders/{id}` | Cancel a pending limit order, return locked funds |

#### Admin only (Bearer JWT, role = admin)
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/admin/users` | List all active users |
| POST | `/api/v1/admin/users` | Create user with any role |
| PATCH | `/api/v1/admin/users/{id}/balance` | Set a user's USDC balance |
| GET | `/api/v1/admin/orders` | All orders (default limit 100, max 1000) |
| GET | `/api/v1/admin/symbols` | Supported symbols |
| GET | `/api/v1/admin/prices` | Live price snapshot |

---

### Technology Choices (Exchange)

#### Rust

**Performance:** Order execution is on the critical latency path — a user's balance check, position update, and order record must all complete before the HTTP response returns. Rust executes this without GC pauses. At market-order rates (tens per second per user) GC pauses in Go or the JVM would introduce occasional multi-millisecond spikes visible as slow trade confirmations.

**Scalability:** `async/await` on tokio handles many concurrent HTTP requests and the background matcher task on a fixed thread pool. The per-user `Mutex` pattern scales linearly with user count — 1000 users means 1000 independent locks, not one bottleneck.

**Maintainability:** The type system enforces the domain model at compile time. `OrderStatus`, `Side`, `OrderType` are enums — a handler cannot accidentally pass `"fille"` where `"filled"` is expected. `thiserror` derives clean error types with no boilerplate.

**Alternatives considered:** Go — simpler concurrency, but GC pauses and weaker type safety for the domain model. Node.js + TypeScript — fast for I/O-bound work but single-threaded CPU execution is a ceiling risk. Python (FastAPI) — insufficient throughput for order execution at scale.

---

#### actix-web

**Performance:** Same reasoning as `fpga-hft-data-generator` — top TechEmpower ranking, multi-threaded tokio workers. The additional concern is that order placement involves two ClickHouse writes and a position read. actix-web's async handlers allow all non-conflicting user requests to run concurrently while the per-user mutex serialises only the writes for the same user.

**Maintainability:** The `AppError` enum with `ResponseError` implementation means all error paths produce consistent `{ "error": "..." }` JSON responses. Handlers are pure functions that receive typed extractors.

**Alternatives considered:** Axum — slightly more ergonomic type-state extractors, but actix-web's middleware ecosystem (CORS, rate limiting) was more complete at project start.

---

#### ClickHouse (as the sole persistent store)

**Performance:** ClickHouse INSERT throughput (millions of rows/sec) far exceeds the exchange-sim's write rate (tens of orders/sec). The cost paid is on reads — `FINAL` on `ReplacingMergeTree` tables is slower than a primary-key lookup in PostgreSQL. This is acceptable because account reads are user-initiated and not on the sub-millisecond path.

**Scalability:** Using one database for all services eliminates a cross-service join problem. The `exchange_user` ClickHouse role has `SELECT` on `hft_dashboard.*` — if the exchange-sim ever needs to query OHLCV data directly, no new connection or API call is required.

**Maintainability:** Single infrastructure dependency. Running `docker-compose up` brings up ClickHouse and both services — no PostgreSQL instance, no Redis, no message broker.

**Alternatives considered:** PostgreSQL — ACID transactions would eliminate the "crash between two writes" limitation. Chosen against because ClickHouse was already required for market data. MongoDB — schemaless is a liability for financial data.

---

#### jsonwebtoken (JWT / HS256)

**Performance:** HMAC-SHA256 signature verification is a single CPU operation — microseconds per request. There is no database roundtrip for auth on the hot path. Only the jti blocklist check (a DashMap lookup) adds any overhead.

**Scalability:** Stateless tokens scale horizontally — any instance of exchange-sim can verify a token without contacting a central auth service.

**Maintainability:** The `Claims` struct defines the token payload as a typed Rust struct. Token expiry is enforced by the library — no manual timestamp comparison in handlers.

**Alternatives considered:** OAuth2 / OpenID Connect — significant added complexity for a simulator. Session cookies — require sticky sessions or a shared session store.

---

#### bcrypt (password hashing)

**Performance:** bcrypt is intentionally slow (work factor controls cost). The hash computation happens only at login and registration — never on the order execution path.

**Scalability:** Work factor can be increased as hardware improves without changing stored hashes. The `user_creation_lock` mutex ensures bcrypt is computed outside the critical section.

**Maintainability:** The bcrypt crate's `verify(password, hash)` API has no footguns — it extracts the salt from the stored hash automatically. Constant-time comparison is built in, preventing timing attacks.

**Alternatives considered:** Argon2id — more modern, memory-hard, recommended by OWASP over bcrypt for new projects. MD5/SHA — never acceptable for password storage.

---

#### tokio-tungstenite (WebSocket client)

**Performance:** The price cache warm-up WebSocket runs as a background tokio task — no dedicated thread, no blocking.

**Scalability:** One persistent WebSocket connection to `fpga-hft-data-generator` is sufficient regardless of how many exchange-sim users are placing orders simultaneously.

**Maintainability:** The `ws_client.rs` module is self-contained — it owns the reconnection logic and the cache update.

**Alternatives considered:** HTTP polling — introduces artificial latency, rate-limit exposure, and unnecessary HTTP overhead. A shared Redis pub/sub channel — adds an infrastructure dependency.

---

### Security (Exchange)

#### Authentication Flow

Every request to a protected endpoint passes through `extract_claims()` before any business logic runs:

```
HTTP request
  └─ extract_claims(req)
       ├─ read Authorization: Bearer <token> header → 401 if absent
       ├─ jsonwebtoken::decode(token, &JWT_SECRET, &Validation)
       │    ├─ verify HMAC-SHA256 signature          → 401 if invalid
       │    └─ verify exp claim (token expiry)       → 401 if expired
       └─ check Claims.jti in blocklist DashMap      → 401 if revoked
            └─ return Claims { user_id, role, jti }
```

**JWT secret:** `JWT_SECRET` is read from the environment variable `JWT_SECRET`. The service does not start with a default secret — an absent or empty value causes a startup panic.

**Token contents:** The JWT payload (`Claims`) encodes `user_id` (UUID), `role` (`trader` / `admin`), `jti` (UUID, unique per token), and `exp` (Unix timestamp). It does not encode the password, balance, or any mutable state.

**Token revocation:** `POST /auth/logout` inserts the token's `jti` into `AppState.blocklist: DashMap<String, i64>`. A background task running every 5 minutes removes entries whose expiry has passed.

**Password hashing:** Passwords are hashed with `bcrypt` before storage. `bcrypt::verify` uses constant-time comparison to prevent timing attacks.

#### Authorization — Role Model

Two roles exist: `trader` (default) and `admin`. The role is embedded in the JWT at login time and re-verified on every request.

| Endpoint group | Who can access | Enforcement |
|---|---|---|
| `POST /auth/register`, `POST /auth/login` | Anyone (no token required) | No `extract_claims()` call |
| `GET /health`, `GET /symbols`, `GET /prices` | Anyone | No `extract_claims()` call |
| `POST /auth/logout` | Authenticated users | `extract_claims()` required; any valid role |
| `GET /account`, `POST /orders`, `GET /orders`, `DELETE /orders/{id}` | Authenticated traders and admins | `extract_claims()` required; any valid role |
| `GET /admin/*`, `POST /admin/*`, `PATCH /admin/*` | Admin only | `extract_claims()` + `require_admin(claims)` |

**`require_admin` check:**
```rust
fn require_admin(claims: &Claims) -> Result<(), AppError> {
    if claims.role == UserRole::Admin {
        Ok(())
    } else {
        Err(AppError::Forbidden("Admin role required"))
    }
}
```

Admin routes return `403 Forbidden` if the `role` claim is `trader`. A trader cannot escalate privileges by modifying the JWT — any tampering invalidates the HMAC signature and causes a `401`.

**User isolation:** All data queries are scoped by `user_id` extracted from the verified JWT claims — not from a query parameter or request body the client controls.

#### Sensitive Data Protection

**Passwords:** Never stored in plaintext. Only the bcrypt hash is written to ClickHouse. The hash is never returned in any API response.

**JWT secret:** Stored only in the environment — not in the codebase, not in ClickHouse. Rotated by changing the env var and restarting the service.

**No sensitive data in logs:** `tracing` log statements record `user_id`, `order_id`, and `symbol` — never passwords, token values, or balance amounts.

#### Secure Communication

**Input validation:** All database queries use parameterized bindings (`client.query("... WHERE id = ?").bind(id)`). There is no string interpolation of user-provided values into SQL — ClickHouse injection is not possible through the API layer.

**Frontend → exchange-sim:** In production, the browser communicates with Vercel over HTTPS. Vercel rewrites `/api/*` to the exchange-sim.

**exchange-sim → ClickHouse:** Plain HTTP on the internal network (Docker Compose). Credentials are passed as HTTP Basic auth headers.

#### Security Gaps (Production Hardening Required)

| Gap | Risk | Recommended fix |
|---|---|---|
| No TLS on exchange-sim | Tokens travel in plaintext on internal network | TLS termination at nginx/envoy, or Rustls in-process |
| Token blocklist lost on restart | Revoked tokens valid again until expiry | Back blocklist with Redis |
| No per-user rate limiting | Unlimited orders per second per user | Per-user sliding window counter in Redis |
| CORS fully open | Any origin can make credentialed requests | Restrict `allow_origin` to Vercel app domain |
| ClickHouse plain HTTP | Credentials and queries in plaintext on network | Enable ClickHouse TLS interface; restrict to private network |

---

### Known Limitations

- **Atomicity across two ClickHouse writes** — the per-user mutex prevents concurrent-request races, but it does not protect against a crash between `insert_order` and `update_user_balance`. Correct fix requires either Postgres (with real transactions) or event-sourcing.
- **Token blocklist does not survive restarts** — the revocation list is in-process memory. Production fix: back the blocklist with Redis.
- **No rate limiting per user** — a user can submit unlimited orders per second.
- **No TLS** — plain HTTP. Production: TLS termination at nginx/envoy or Rustls directly.
- **CORS is fully open** — production: restrict to the known frontend origin.
- **Limit order matching is price-only, no time priority** — the matcher fills limit orders based purely on whether the market price crossed the limit price.
- **ClickHouse schema change requires container recreation** — the `exchange.orders` table was changed from `MergeTree` to `ReplacingMergeTree(updated_at)`. Existing deployments must run `docker-compose down -v && docker-compose up -d`.

---

### Dependencies

| Crate | Purpose |
|---|---|
| `actix-web` | HTTP server |
| `actix-cors` | CORS middleware |
| `clickhouse` | ClickHouse HTTP client |
| `dashmap` | Lock-free concurrent hashmap (price cache, user locks, token blocklist) |
| `tokio-tungstenite` | WebSocket client (HFT feed consumer) |
| `jsonwebtoken` | JWT sign/verify (HS256) |
| `bcrypt` | Password hashing |
| `rust_decimal` | Exact decimal arithmetic for balances/prices |
| `uuid` | Order, user, and jti ID generation |
| `thiserror` | Error enum boilerplate |
| `tracing` + `tracing-subscriber` | Structured logging |
| `dotenvy` | `.env` file loading |
| `tokio-util` | `CancellationToken` for graceful shutdown |

---

## 4. React Frontend Dashboard
[Github repository](https://github.com/aleynaalangil/bull-tech-dashboard)
A real-time high-frequency trading (HFT) dashboard built with React, TypeScript, and Vite. Connects to an exchange simulator backend and HFT gateway for market data streaming, order execution, and P&L tracking.

### Tech Stack

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

### Technology Choices (Frontend)

#### React 19

**Performance:** Concurrent rendering lets React interrupt low-priority work (e.g. re-rendering a large order history list) to keep the price ticker and chart responsive to high-frequency WebSocket updates. `React.memo` + granular Zustand selectors mean components only re-render when their specific data slice changes — critical when ticks arrive at 100/sec.

**Scalability:** Adding a new panel (e.g. depth chart, heatmap) means a new isolated component with its own Zustand selector — no coordination with existing components required.

**Maintainability:** Hooks eliminate class component lifecycle complexity. The explicit data flow (Zustand → selector → component) makes render behaviour predictable and debuggable.

**Alternatives considered:** Vue 3 and Svelte are both fast. React was chosen because its ecosystem (Sentry SDK, lightweight-charts React wrapper, extensive hook patterns for WebSocket) is more mature for real-time financial dashboards.

---

#### TypeScript (strict mode)

**Performance:** No runtime cost — TypeScript compiles to plain JavaScript. The performance benefit is indirect: catching type errors at build time prevents incorrect data handling that would cause silent incorrect calculations at runtime.

**Scalability:** As the codebase grows, strict types act as machine-checked documentation. Adding a new WebSocket message field requires updating the `WsMessage` interface first — the compiler then finds every handler that needs updating.

**Maintainability:** `strict: true` + `noUncheckedIndexedAccess` forces explicit handling of `undefined` from array lookups and optional fields. This is especially important for financial data where a silent `NaN` from an unguarded parse is worse than a type error that stops the build.

**Alternatives considered:** Plain JavaScript. Rejected because the WebSocket message shape, Zustand store shape, and API response shapes form a complex contract — types make violations immediately visible.

---

#### Vite

**Performance:** Native ESM in development means only changed modules are re-evaluated on save — HMR updates in under 50ms regardless of project size.

**Scalability:** Vite's plugin ecosystem (Rollup-compatible) handles code splitting, dynamic imports, and tree-shaking out of the box. The dev proxy middleware (`vite.config.ts`) eliminates CORS issues in development without any backend changes.

**Maintainability:** Zero-config TypeScript and React support. The mock API middleware is colocated in `vite.config.ts`.

**Alternatives considered:** Create React App (deprecated), webpack. Both are slower in development. Next.js was considered but rejected — this is a pure SPA with no server-side rendering needs.

---

#### Zustand

**Performance:** Zustand's selector model (`useTradeStore(state => state.prices[symbol]?.bbo)`) means components subscribe only to the exact slice they need. A price tick that updates `bbo` does not re-render `MetricsPanel` (which selects `telemetry`).

**Scalability:** The store scales by adding new state slices and actions with no boilerplate. Middleware (localStorage persistence) is a one-line addition.

**Maintainability:** The entire store is defined in a single `store.ts` file (~200 lines). There are no action creators, reducers, or selectors to keep in sync.

**Alternatives considered:** Redux Toolkit — more boilerplate. Jotai/Recoil — atom-based models are less natural for a deeply nested shared market data structure. Context API — re-renders every consumer on any state change, unacceptable at 100 ticks/sec.

---

#### Lightweight Charts (TradingView)

**Performance:** Renders using WebGL/Canvas rather than SVG. SVG-based chart libraries (Chart.js, Recharts) create a DOM node per data point — at 1,440 candles for a 24h 1m chart this causes layout thrashing on updates. Lightweight Charts renders the entire chart in a single canvas draw call.

**Scalability:** Handles 1M+ data points with no visible degradation. The `update()` API appends a single new candle without redrawing historical data.

**Alternatives considered:** Chart.js — general-purpose, SVG, not optimised for financial data. D3.js — maximum flexibility but requires building candlestick rendering from scratch (~500 lines). Recharts — React-native but SVG-based.

---

#### BigNumber.js

**Performance:** Slower than native `float64` arithmetic, but for a trading dashboard this is irrelevant — price display and P&L calculation happen at most 10 times per second per symbol.

**Scalability:** `BigNumber` serializes cleanly to/from strings for localStorage persistence and JSON API responses.

**Maintainability:** Makes incorrect arithmetic visible. `new BigNumber('0.1').plus('0.2').toString()` returns `'0.3'` exactly. `0.1 + 0.2` in float64 returns `0.30000000000000004`. For balance displays and P&L calculations this difference is user-visible.

**Alternatives considered:** `decimal.js` — similar precision guarantees, slightly smaller bundle.

---

#### Sentry

**Performance:** The SDK is lazy-loaded and gated on `VITE_SENTRY_DSN`. When the DSN is absent (development, CI) the SDK never initialises and has zero runtime overhead.

**Scalability:** Sentry's error grouping automatically deduplicates repeated errors across thousands of users. Source maps uploaded at build time give readable stack traces.

**Alternatives considered:** Datadog RUM, LogRocket. Both are more expensive and require more configuration.

---

### Project Structure

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
    │   ├── historical_trades.sql
    │   ├── market_ohlc.sql
    │   └── system_metrics.sql
    └── queries/
        ├── ohlcv_candles.sql
        ├── materialized_view_1m.sql
        └── materialized_views_multi.sql   # 5m / 15m / 1h / 1d MVs + backfill queries
```

---

### Architecture

#### State Management

Zustand is used for all global state. The store holds two categories of data:

- **Ephemeral (not persisted):** `prices`, `alerts`, `wsStatus`. These are repopulated from the WebSocket on each session and never written to localStorage.
- **Persisted to localStorage:** `priceAlerts`, `pendingOrders`. These survive page reloads and are restored on startup.

```
store.ts
├── MarketData       — per-symbol price, volume, BBO, tick, OHLC, telemetry
├── BboSnapshot      — best bid/ask + 5 levels each side
├── PriceAlert       — target price, above/below condition, buy/sell action
├── PendingOrder     — limit or stop-limit, waiting/triggered status
├── Alert            — toast notification (critical/info)
└── WsStatus         — 'connecting' | 'connected' | 'reconnecting'
```

---

#### WebSocket Data Flow

`useMarketDataStream` connects to `VITE_WS_URL`. It does not pass raw messages directly to React state:

1. Incoming messages are written into a per-symbol buffer (latest update only).
2. A 100ms interval flushes the buffer into Zustand (`updatePrice`), atomically clearing it.
3. `updatePrice` deep-merges the partial update. Optional fields (`change_1h`, `change_24h`, `bbo`, `ohlc`, `tick`, `telemetry`) are only written to the partial when the raw message actually includes them — absent fields never overwrite existing store values.
4. Telemetry values (latency, throughput, error rate) are smoothed with EMA (α=0.05) to reduce visual noise.
5. `setWsStatus` is called at each connection lifecycle event: `connecting` before socket creation, `connected` on open, `reconnecting` on close.

Reconnection uses exponential backoff: 500ms → 1s → 2s → ... → 30s ceiling.

**React StrictMode safety:** The hook uses a closure-local `isMounted` boolean to track whether a given effect instance is still live. Using a ref was unsafe because StrictMode mounts, unmounts, and remounts the effect — the second mount would reset the ref to `true` before the first socket's async `onclose` fired, causing spurious reconnects.

The `WsStatusBadge` component in `App.tsx` reads `wsStatus` from the store and renders a green/amber/red pill in the header:
- Green + pulse: connected
- Amber + pulse: reconnecting (in backoff)
- Red: initial connection attempt in progress

---

#### Order Execution Architecture

The exchange-sim backend only accepts **market orders** natively. Limit and stop-limit orders are implemented entirely on the frontend:

- **`usePriceAlerts`:** Watches live prices against stored `priceAlerts`. When a condition is met (price crosses target), fires a market order via `POST /api/v1/orders` and removes the alert.
- **`usePendingOrders`:** Manages limit and stop-limit orders stored in Zustand.
  - **Limit:** Executes when `currentPrice <= limitPrice` (buy) or `currentPrice >= limitPrice` (sell).
  - **Stop-limit (two-phase):**
    - Phase 1 (`waiting`): Monitor for `stopPrice` cross → transition to `triggered`.
    - Phase 2 (`triggered`): Behave as a limit order on `limitPrice`.

Both hooks use refs (`firingRef`, `submittingSymbolsRef`) to prevent double-execution and serialize API calls per symbol.

---

#### TradeInterface Component Architecture

`TradeInterface.tsx` is a thin shell (~180 lines) responsible for:
- Tab routing (Spot / Alerts / PnL / Orders)
- Account data fetch (`GET /api/v1/account`) with error state and retry button
- Shared order-type state (`orderType`, `limitPrice`, `stopPrice`) passed to both columns
- `handleExecute` — validates and dispatches market, limit, or stop-limit orders
- Result overlay modal with optimistic pending state

**Optimistic UI:** Market order submission immediately shows a blue "Submitting…" overlay. The modal transitions to green (filled) or red (rejected) when the API responds.

The spot tab renders two `OrderFormColumn` instances (buy and sell). Each column uses the `useOrderForm` hook which owns per-side `qty` state, quantity validation, and quick-amount calculation. The alert creation form, active alerts list, and pending orders list live in `AlertsTab`.

---

#### Render Performance

`OrderBook` and `MetricsPanel` use granular Zustand selectors:

```typescript
// OrderBook — only the BBO slice
const bbo = useTradeStore((state) => state.prices[symbol]?.bbo);

// MetricsPanel — only the telemetry slice
const telemetry = useTradeStore((state) => state.prices[symbol]?.telemetry);
```

Both components are wrapped with `React.memo`. Because `bbo` and `telemetry` are only replaced with new object references when their data actually changes (absent fields preserve the existing reference through spread-merge), components skip re-renders on every price or OHLC tick that does not affect them.

---

#### Chart Data Flow

1. On symbol selection or timeframe change, `Chart.tsx` fetches historical OHLCV from `/api/v1/ohlcv/{symbol-slug}?interval={tf}&minutes={window}`.
2. Five timeframes are available: 1m (24h window), 5m (5d), 15m (15d), 1h (30d), 1d (3 months).
3. The fetch is tied to an `AbortController`. The cleanup function calls `abortController.abort()` before removing the chart, preventing the React StrictMode double-invoke from firing two concurrent requests.
4. Data is loaded into a `CandlestickSeries` from lightweight-charts via `setData`.
5. Live `ohlc` updates from Zustand are applied to the series as they arrive from the WebSocket.

**Multi-timeframe backend:** The `interval` query parameter routes to the correct ClickHouse MV. The HFT gateway accepts `?interval=1m|5m|15m|1h|1d` and passes it to `get_historical_ohlc` in `db.rs`. If the MV is empty, the query falls back to on-the-fly `GROUP BY` aggregation from raw trades.

---

#### Real-Time Update Pipeline

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

**Why 100ms buffer instead of immediate state update:** At 100 ticks/sec (10ms interval) calling `setState` on every message would schedule 100 React render cycles per second. The 100ms interval reduces renders to 10/sec while showing the latest data — a rate imperceptible to human users but with 90% less render work.

---

#### State Synchronization & Consistency Guarantees

**Single source of truth.** All market data lives in one Zustand store. No component holds its own copy of price or BBO data. When the 100ms flush writes to the store, every component that subscribes to that data re-renders in the same React commit cycle.

**React batching guarantees atomic commits.** React 19 batches all state updates triggered within a single synchronous call. The `updatePrice` Zustand action is a synchronous `set` call inside the `setInterval` callback — React processes all resulting selector notifications in one pass and commits a single new DOM snapshot.

**Partial merge prevents false zeroes.** A WebSocket message may include only `{price, volume}` and omit `change_1h`. Writing `change_1h: undefined` (or `BigNumber(0)` from a `null`) to the store would overwrite the last known value, causing the ticker to show `▲ 0.00%` until the next real poll. Two guards prevent this: (1) Rust omits the field entirely when `None` via `skip_serializing_if`, so `raw.change_1h` is `undefined` in JS; (2) the frontend guard is `!= null` (catches both `null` and `undefined`). Absent keys are never written to the partial, so the store retains the last known value indefinitely.

**Referential stability for memoized components.** When a tick updates `price` but the message contains no `bbo` key, the `bbo` object in the store is not replaced — the same object reference survives the merge. Zustand compares selector return values by reference. `OrderBook`'s selector returns the same `bbo` reference → Zustand does not notify `OrderBook` → `React.memo` does not schedule a re-render.

**Stale data on disconnect.** When the WebSocket closes, the buffer stops being flushed and Zustand is not updated. Components continue to display the last known values rather than showing empty or zeroed state. The `WsStatusBadge` (amber/red) communicates to the user that data may be stale.

**Optimistic UI consistency.** Market orders show a blue "Submitting…" overlay immediately on click — before the API responds. The overlay prevents the user from submitting a second order while the first is in flight.

---

#### Numeric Precision

All financial values use `BigNumber.js`. Float arithmetic is never used for prices or quantities. ClickHouse stores prices and amounts as `Decimal64(8)` (8 decimal places). The order book component divides raw values by 100,000,000 to match the fixed-point encoding from the Rust backend.

All WebSocket message fields are parsed through `toBN(val: unknown)` which uses a type guard (`typeof val !== 'string' && typeof val !== 'number'`) before constructing a BigNumber, satisfying TypeScript strict mode without unsafe casts.

---

#### Authentication

Tokens are stored in `localStorage` as `exchange_token` and `exchange_user`. `authFetch` is a thin wrapper that injects `Authorization: Bearer {token}` into every API call. On 401, auth is cleared and the user is redirected to `/login`.

`EXCHANGE_URL` is read from `VITE_EXCHANGE_URL`. An empty string is valid and signals Vercel rewrite mode — all exchange API calls become relative paths and are proxied by `vercel.json`.

`RequireAuth` is a React component that checks `isLoggedIn()` on every render; unauthenticated users are redirected to `/login` via React Router.

---

### Security (Frontend)

#### Authentication Implementation

**Token lifecycle:**
1. User submits credentials → `POST /api/v1/auth/login` → exchange-sim validates bcrypt hash → returns JWT
2. JWT is stored in `localStorage` under `exchange_token`
3. Every subsequent API call goes through `authFetch`, which reads the token from localStorage and injects `Authorization: Bearer <token>` into the request header
4. On any `401 Unauthorized` response, `clearAuth()` wipes both localStorage keys and React Router redirects to `/login`
5. On logout, `POST /api/v1/auth/logout` is called to add the token's `jti` to the exchange-sim blocklist before clearing localStorage

**localStorage vs httpOnly cookies — conscious trade-off:** Storing JWTs in `localStorage` exposes them to JavaScript, meaning an XSS attack can exfiltrate the token. `httpOnly` cookies are not readable by JS and are the safer alternative. The trade-off: `localStorage` was chosen because the frontend makes cross-origin requests in development where cookie `SameSite` rules would block them. The XSS vector is mitigated by the Content Security Policy. For a production financial service, migrating to `httpOnly Secure SameSite=Strict` cookies is the correct hardening step.

**CSRF protection:** Bearer token authentication is inherently CSRF-safe. CSRF attacks exploit the browser's automatic cookie inclusion on cross-origin requests. Since the JWT is injected manually by `authFetch` from localStorage, a forged cross-origin form submission cannot include it.

#### Authorization

**Route-level guard — `RequireAuth`:**
```
App.tsx
└─ <RequireAuth>           ← checks isLoggedIn() (localStorage token present)
     └─ <MarketDashboard>  ← only rendered when authenticated
          └─ <TradeInterface>, <Chart>, <OrderBook>, ...
```

**API-level enforcement:** All route protection is ultimately enforced by the exchange-sim backend. The frontend guard is a UX convenience — it cannot and does not replace server-side token verification.

**Role visibility:** The frontend does not render different UI for `trader` vs `admin` roles. Admin-only capabilities are accessible only through the exchange-sim admin API endpoints.

#### Sensitive Data Protection

**Credentials never stored:** Passwords are submitted once to `/api/v1/auth/login` and never held in JavaScript state or localStorage.

**No financial data in localStorage:** Zustand's localStorage persistence covers only `priceAlerts` and `pendingOrders`. Account balances, order history, and position data are fetched from the API on demand and held only in ephemeral Zustand state.

**Environment variables:** All secrets (API URLs, Sentry DSN) are injected at build time via `VITE_*` env vars.

#### Transport Security

**HTTPS enforcement (production):** Vercel serves all responses over HTTPS and redirects HTTP to HTTPS automatically.

**WebSocket TLS:** `VITE_WS_URL` must be a `wss://` URL in production.

#### Content Security Policy

`vercel.json` injects the following headers on every response:

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'`; controlled script/style allowlist; `connect-src` restricted to known WSS and API origins | Blocks injection of foreign scripts; restricts where JS can connect |
| `X-Frame-Options` | `DENY` | Prevents the dashboard from being embedded in an iframe (clickjacking) |
| `X-Content-Type-Options` | `nosniff` | Prevents browsers from MIME-sniffing responses as a different content type |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer header exposure to same-origin navigations |
| `Permissions-Policy` | camera, microphone, geolocation all blocked | Removes access to browser APIs the dashboard never uses |

#### Security Gaps (Production Hardening Required)

| Gap | Risk | Recommended fix |
|---|---|---|
| JWT in localStorage | XSS can exfiltrate token | Migrate to `httpOnly Secure SameSite=Strict` cookies |
| No token expiry UI | Expired token causes silent 401 on first API call | Show "Session expired — please log in again" banner on 401 |
| No HTTPS on dev WS | `ws://` in development | Enforce `wss://` via env var validation before production deploy |
| Admin UI absent | Admin operations require direct API calls | Build admin panel for balance and user management |

---

### Structured Logging

`src/logger.ts` exports a `logger` object with `debug / info / warn / error` methods.

- **Development:** Pretty-prints with level prefix to the browser console.
- **Production:** Emits `JSON.stringify`-ed `LogEntry` objects, consumable by DataDog, CloudWatch Logs, or any JSON-aware log aggregator.

### Error Tracking (Sentry)

Sentry is initialized in `main.tsx` and gated on the `VITE_SENTRY_DSN` environment variable.

- 10% transaction sampling (`tracesSampleRate: 0.1`)
- 1% session replay, 100% replay on error

---

### Production Deployment (Vercel)

#### CORS Strategy

**REST endpoints — `vercel.json` rewrites (same-origin proxying):**

```
/api/v1/ohlcv/*  →  https://your-hft-gateway.example.com/api/v1/ohlcv/*
/api/*           →  https://your-exchange-sim.example.com/api/*
```

Rewrite order matters: the ohlcv rule is evaluated first so HFT gateway OHLCV calls are not captured by the broader exchange-sim rule.

**WebSocket — direct URL with backend CORS:** Vercel rewrites do not proxy WebSocket connections. `VITE_WS_URL` must be a direct `wss://` address.

#### Environment Variables

**Development (`.env`):**
```env
VITE_WS_URL=ws://localhost:5173/v1/feed
VITE_API_URL=
VITE_EXCHANGE_URL=http://localhost:8081
VITE_MOCK_API=true
```

**Production (Vercel dashboard):**
```env
VITE_WS_URL=wss://your-hft-gateway.example.com/v1/feed
VITE_API_URL=
VITE_EXCHANGE_URL=
VITE_SENTRY_DSN=https://...
```

---

### What Has Been Done

- **Authentication:** Login/register with JWT token storage, protected routes, `authFetch` wrapper.
- **Real-time market data:** WebSocket streaming with buffered flush (100ms), partial deep-merge updates, EMA-smoothed telemetry, exponential backoff reconnection, StrictMode-safe closure-local mount tracking.
- **WS connection status badge:** Live header badge shows connected (green), reconnecting (amber), or connecting (red) state driven by Zustand `wsStatus`.
- **Market orders:** Instant execution via exchange-sim API with optimistic UI.
- **Client-side limit orders:** Stored in localStorage, auto-executed when price crosses limit.
- **Client-side stop-limit orders:** Two-phase execution (stop trigger → limit execute), also persisted.
- **Price alerts:** Auto-fire market orders when price crosses a set target, with deduplication.
- **Bulk order management:** "Cancel All" buttons in AlertsTab clear all pending orders or price alerts for the current symbol.
- **Level 2 order book:** 5 levels each side, size bars, spread display. Memoized — only re-renders when BBO data changes.
- **Candlestick chart:** Historical OHLCV load + live updates, crosshair tooltip, AbortController-safe fetch, timeframe selector (1m / 5m / 15m / 1h / 1d).
- **P&L panel:** Realized and unrealized breakdown, filterable by order type, open positions table, manual refresh button, error state with retry.
- **Order history panel:** Per-order transaction log showing timestamp, symbol, side, order type, quantity, fill price, and status. Filterable by buy/sell.
- **Telemetry:** Latency, throughput, error rate with EMA smoothing and color thresholds. Memoized metrics panel.
- **Account fetch error handling:** Inline amber banner with retry button when `/api/v1/account` fails.
- **TradeInterface refactor:** Thin shell + `OrderFormColumn` (shared buy/sell column) + `useOrderForm` hook + `AlertsTab` + `OrderHistoryPanel` components.
- **TypeScript strict compliance:** All WebSocket message fields typed via `WsMessage` interface; `toBN` uses type guards; no `any` casts in the data pipeline.
- **1h/24h change fix:** `change_1h` and `change_24h` carry `skip_serializing_if = "Option::is_none"` in Rust — absent from JSON when not yet polled. Frontend guard changed from `!== undefined` to `!= null` to also block explicit `null`. Together these ensure the store is never overwritten with a spurious zero, and `TopTickerBar` renders `—` until a real polled value arrives.
- **Dark HFT terminal UI:** Tailwind + custom CSS, flash animations on price change, responsive 3-column layout.
- **Dev proxy:** Vite proxies `/api/v1/ohlcv` and `/v1/feed` to the HFT gateway.
- **Chart multi-timeframe backend wired up:** `fpga-hft-data-generator` `api.rs` accepts `?interval=` and routes it to the correct ClickHouse MV in `db.rs`.

---

### Known Limitations

- **Technical indicators:** No moving averages, RSI, VWAP, or drawing tools.
- **Rate limit feedback:** No UI warning when exchange-sim rate limits are hit since there is no rate limit implementation in exchange-sim at the moment.
- **Past alerts history:** Fired alerts isn't shown in UI.
- **Two-factor authentication:** Auth is single-factor only.
- **Client-side order book is a reliability risk.** Limit and stop-limit orders live only in localStorage. Browser storage cleared, a second tab open, or a crash mid-order can cause silent loss or double-execution. This logic belongs in the backend.
- **No tests** (unit, integration, or E2E).
- **No CI pipeline** or test scripts in `package.json`.

---

## 5. ClickHouse Database Design
[Github repository](https://github.com/aleynaalangil/clickhouse-config)
### Overview

Two ClickHouse databases serve the full system. `hft_dashboard` is owned by `fpga-hft-data-generator` and holds all market data. `exchange` is owned by `exchange-sim` and holds all account state. `exchange-sim` also holds a cross-database `SELECT` grant on `hft_dashboard` so it can read live prices directly.

The authoritative schema is in `clickhouse-config/init.sql`. The `fpga-hft-data-generator/schema/schema.sql` file is a developer-facing subset used for standalone bringup without Docker Compose.

The frontend (`state`) has no direct ClickHouse connection. All data access goes through REST API calls to `exchange-sim` (`/api/v1/*`) and `fpga-hft-data-generator` (`/api/v1/ohlcv/*`).

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
- 90-day TTL — chart data beyond 3 months is rarely needed for a trading dashboard.

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
- **Backfill:** MVs only capture new inserts from creation time. The SQL file (`db/queries/materialized_views_multi.sql`) includes commented `INSERT...SELECT` backfill queries that re-aggregate existing `historical_trades` data — run these once on first deploy.

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
- `balance_usdc` as String — the exchange-sim serialises balances as decimal strings to avoid f64 rounding. Rust `rust_decimal::Decimal` parses the string at read time.

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

---

### Query Performance Notes

#### Design choices that prevent slow queries at scale

**1. ORDER BY prefix alignment**

Every production query filters on the leading column(s) of the ORDER BY key before applying any other predicate. Violating this forces a full-table scan across all granules.

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
- For admin full-table scans on large datasets, consider adding a `created_at` range filter to limit the partition scan before FINAL deduplication runs.

**3. Materialized views eliminate GROUP BY on raw ticks**

| Approach | Rows scanned for 1h of 5m candles |
|---|---|
| GROUP BY on `historical_trades` | ~720,000 raw tick rows |
| SELECT from `historical_trades_mv_5m` | ~24 pre-merged candle rows |

The MV fallback (on-the-fly GROUP BY) is used only when the MV is empty — during the first minutes after deployment before backfill runs.

**4. Batched inserts**

`fpga-hft-data-generator` buffers trade rows and flushes in batches (1,000 rows or 1 second, whichever comes first). ClickHouse is optimised for bulk inserts; single-row inserts at 100/sec would create ~360,000 small parts per hour, overwhelming the background merger and eventually causing `Too many parts` errors.

**5. Partition pruning**

Monthly partitions on `historical_trades` and `exchange.orders` mean queries with a `timestamp >= now() - INTERVAL N MINUTE` condition only open the current (and possibly previous) month's partition files.

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

## 6. System Architecture Sequence Diagram

A complete PlantUML sequence diagram covering all component interactions is available at this [link](https://sapphire-written-tiger-351.mypinata.cloud/ipfs/bafkreiht5yrwetggv6jkpd3hxgtjn2o5qmcr4mvnqlge3izps7ctldqyme).


The diagram covers all interaction flows in order:

1. **Service Startup** — FPGA backfill, ClickHouse readiness poll, exchange-sim price cache warm-up
2. **Tick Generation Loop (every 10ms)** — GBM advance, BBO update, DB buffer, candle closure, WS broadcast
3. **Frontend WebSocket Connection & Buffered State Update** — 100ms flush, Zustand partial merge, component re-render
4. **WebSocket Reconnection** — exponential backoff, WsStatusBadge state transitions
5. **Authentication** — login, bcrypt verify, JWT issuance, localStorage storage
6. **Chart — Historical OHLCV Load** — interval routing, MV query, on-the-fly fallback, lightweight-charts setData
7. **Market Order Placement** — per-user mutex, balance check, DashMap exec price, dual ClickHouse writes
8. **Client-Side Limit Order** — Zustand localStorage persistence, price-crossing evaluation, market order dispatch
9. **Price Alert Trigger** — stored alert evaluation on every tick, market order on crossing, toast notification
10. **Order History** — `GET /api/v1/orders`, SELECT FINAL, OrderHistoryPanel render
11. **Account & P&L** — balance + positions fetch, unrealized P&L from DashMap live prices, PnlPanel render

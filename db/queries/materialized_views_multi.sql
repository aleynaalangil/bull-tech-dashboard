-- Multi-Timeframe OHLCV Materialized Views
-- Mirrors the pattern of materialized_view_1m.sql for 5m, 15m, 1h, and 1d intervals.
-- Uses toStartOfInterval(...) which is universally supported across ClickHouse versions.
-- Run once against hft_dashboard after the 1m MV is already in place.
--
-- Querying (use *Merge aggregation functions against AggregatingMergeTree):
--   SELECT
--       symbol, candle_time,
--       argMinMerge(open) AS open, maxMerge(high) AS high,
--       minMerge(low) AS low, argMaxMerge(close) AS close,
--       sumMerge(volume) AS volume
--   FROM hft_dashboard.historical_trades_mv_5m
--   WHERE symbol = 'BTC/USDC'
--     AND candle_time >= now() - INTERVAL 5 DAY
--   GROUP BY symbol, candle_time
--   ORDER BY candle_time ASC;
--
-- Replace the table name and INTERVAL window for each timeframe.

-- ── 5-minute candles ────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS hft_dashboard.historical_trades_mv_5m
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, candle_time)
AS SELECT
    symbol,
    toStartOfInterval(timestamp, INTERVAL 5 MINUTE) AS candle_time,
    argMinState(price, timestamp) AS open,
    maxState(price)               AS high,
    minState(price)               AS low,
    argMaxState(price, timestamp) AS close,
    sumState(amount)              AS volume
FROM hft_dashboard.historical_trades
GROUP BY symbol, candle_time;

-- ── 15-minute candles ───────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS hft_dashboard.historical_trades_mv_15m
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, candle_time)
AS SELECT
    symbol,
    toStartOfInterval(timestamp, INTERVAL 15 MINUTE) AS candle_time,
    argMinState(price, timestamp) AS open,
    maxState(price)               AS high,
    minState(price)               AS low,
    argMaxState(price, timestamp) AS close,
    sumState(amount)              AS volume
FROM hft_dashboard.historical_trades
GROUP BY symbol, candle_time;

-- ── 1-hour candles ──────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS hft_dashboard.historical_trades_mv_1h
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, candle_time)
AS SELECT
    symbol,
    toStartOfHour(timestamp) AS candle_time,
    argMinState(price, timestamp) AS open,
    maxState(price)               AS high,
    minState(price)               AS low,
    argMaxState(price, timestamp) AS close,
    sumState(amount)              AS volume
FROM hft_dashboard.historical_trades
GROUP BY symbol, candle_time;

-- ── 1-day candles ───────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS hft_dashboard.historical_trades_mv_1d
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, candle_time)
AS SELECT
    symbol,
    toStartOfDay(timestamp) AS candle_time,
    argMinState(price, timestamp) AS open,
    maxState(price)               AS high,
    minState(price)               AS low,
    argMaxState(price, timestamp) AS close,
    sumState(amount)              AS volume
FROM hft_dashboard.historical_trades
GROUP BY symbol, candle_time;

-- ── Backfill note ────────────────────────────────────────────────────────────
-- MVs only capture new inserts from the moment they are created.
-- To backfill historical data into each MV, run an INSERT...SELECT from the
-- historical_trades table using the same GROUP BY logic:
--
INSERT INTO hft_dashboard.historical_trades_mv_5m
SELECT
    symbol,
    toStartOfInterval(timestamp, INTERVAL 5 MINUTE) AS candle_time,
    argMinState(price, timestamp),
    maxState(price),
    minState(price),
    argMaxState(price, timestamp),
    sumState(amount)
FROM hft_dashboard.historical_trades
GROUP BY symbol, candle_time;
--
-- Repeat with the appropriate interval and MV name for each timeframe.

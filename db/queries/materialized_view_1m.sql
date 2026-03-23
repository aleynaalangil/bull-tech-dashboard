-- Materialized View for Instant Chart Loading
-- Pre-calculates OHLCV data as it arrives so the API can fetch chart data
-- instantly without taxing the CPU. Defaults to LZ4 compression to
-- prioritize read-speed over disk space.

CREATE MATERIALIZED VIEW historical_trades_mv_1m
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, candle_time)
AS SELECT
    symbol,
    toStartOfMinute(timestamp) AS candle_time,
    argMinState(price, timestamp) AS open,
    maxState(price) AS high,
    minState(price) AS low,
    argMaxState(price, timestamp) AS close,
    sumState(amount) AS volume
FROM historical_trades
GROUP BY symbol, candle_time;

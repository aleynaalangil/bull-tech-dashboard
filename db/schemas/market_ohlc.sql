-- OHLC 1-minute Candles Schema
CREATE TABLE IF NOT EXISTS hft_dashboard.market_ohlc (
    symbol String CODEC(ZSTD(3)),
    candle_time DateTime64(6, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    open Decimal64(8) CODEC(ZSTD(3)),
    high Decimal64(8) CODEC(ZSTD(3)),
    low Decimal64(8) CODEC(ZSTD(3)),
    close Decimal64(8) CODEC(ZSTD(3)),
    volume Decimal64(8) CODEC(ZSTD(3))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(candle_time)
ORDER BY (symbol, candle_time)
-- Retention: Keep 1-minute bars for 30 days, then delete.
-- ClickHouse handles compression automatically via ZSTD.
TTL toDateTime(candle_time) + INTERVAL 30 DAY DELETE;

-- Grant permissions to inserter_user
GRANT INSERT ON hft_dashboard.market_ohlc TO inserter_user;

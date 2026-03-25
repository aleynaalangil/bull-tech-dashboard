CREATE DATABASE IF NOT EXISTS hft_dashboard;

-- Core HFT Trade Schema
CREATE TABLE IF NOT EXISTS hft_dashboard.historical_trades (
    symbol String CODEC(ZSTD(3)), 
    side Enum8('buy' = 1, 'sell' = 2),
    price Decimal64(8) CODEC(ZSTD(3)),
    amount Decimal64(8) CODEC(ZSTD(3)),
    timestamp DateTime64(6, 'UTC') CODEC(DoubleDelta, ZSTD(1)), 
    order_id String CODEC(ZSTD(3)),
    trader_id UInt32 CODEC(ZSTD(1))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp) -- Monthly partitions
ORDER BY (symbol, timestamp);    -- Primary index optimized for time-series lookups

CREATE USER IF NOT EXISTS inserter_user IDENTIFIED WITH plaintext_password BY 'inserter_pass';
GRANT INSERT ON hft_dashboard.historical_trades TO inserter_user;

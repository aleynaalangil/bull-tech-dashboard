-- Core HFT Trade Schema
-- Stores raw tick data with financial-grade precision.
-- Uses Decimal64 to prevent rounding errors and aggressive
-- column-level compression (ZSTD + DoubleDelta) to mitigate disk I/O bottlenecks.

CREATE TABLE historical_trades (
    symbol String CODEC(ZSTD(3)), 
    side Enum8('buy' = 1, 'sell' = 2),
    
    -- Decimal64(8) ensures financial accuracy without sacrificing 
    -- too much of the processing speed of Float64.
    price Decimal64(8) CODEC(ZSTD(3)),
    amount Decimal64(8) CODEC(ZSTD(3)),
    
    -- DoubleDelta records the difference between timestamps, 
    -- and ZSTD compresses those tiny integers for massive space savings.
    timestamp DateTime64(6, 'UTC') CODEC(DoubleDelta, ZSTD(1)), 
    
    order_id String CODEC(ZSTD(3)),
    trader_id UInt32 CODEC(ZSTD(1))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp) -- Monthly partitions
ORDER BY (symbol, timestamp);    -- Primary index optimized for time-series lookups

-- System Performance Monitoring Schema
-- Handles the massive influx of system logs for real-time
-- latency, throughput, and error metrics.
-- Uses maximum compression for storage efficiency and daily partitions for easy log rotation.

CREATE TABLE system_metrics (
    -- LowCardinality is perfect for repetitive strings like metric names
    metric_name LowCardinality(String) CODEC(ZSTD(1)), 
    
    -- Float64 is safe here as this is non-financial telemetry data
    value Float64 CODEC(ZSTD(3)), 
    
    timestamp DateTime64(6, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
    server_id String CODEC(ZSTD(1))
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp) -- Daily partitions for easier dropping/archiving
ORDER BY (metric_name, timestamp);

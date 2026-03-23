-- Historical Data Visualization Query
-- Aggregates raw ticks into 1-minute OHLCV (Open, High, Low, Close, Volume) candlesticks.
--
-- NOTE: Because `amount` is a Decimal64, the sum(amount) function will automatically
-- promote the result to Decimal128 to prevent overflow. The backend/frontend must be
-- typed to handle this 128-bit response.

SELECT
    toStartOfMinute(timestamp) AS candle_time,
    argMin(price, timestamp) AS open,
    max(price) AS high,
    min(price) AS low,
    argMax(price, timestamp) AS close,
    sum(amount) AS volume
FROM historical_trades
WHERE symbol = 'SOL/USDC' 
  AND timestamp >= now() - INTERVAL 24 HOUR
GROUP BY candle_time
ORDER BY candle_time ASC;

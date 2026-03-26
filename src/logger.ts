// Structured frontend logger.
// In development: pretty-prints with level prefix to the browser console.
// In production: emits JSON to console so a log aggregator (DataDog,
// CloudWatch Logs, etc.) can ingest structured entries.

const isDev = import.meta.env.DEV;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: string;
    context?: Record<string, unknown>;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry: LogEntry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...(context !== undefined ? { context } : {}),
    };

    if (isDev) {
        const fn =
            level === 'error' ? console.error :
            level === 'warn'  ? console.warn  :
            level === 'debug' ? console.debug :
            console.info;
        fn(`[${level.toUpperCase()}] ${message}`, context ?? '');
    } else {
        // Structured JSON — forward to Sentry breadcrumbs or a log sink.
        const fn =
            level === 'error' ? console.error :
            level === 'warn'  ? console.warn  :
            console.log;
        fn(JSON.stringify(entry));
    }
}

export const logger = {
    debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
    info:  (message: string, context?: Record<string, unknown>) => emit('info',  message, context),
    warn:  (message: string, context?: Record<string, unknown>) => emit('warn',  message, context),
    error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};

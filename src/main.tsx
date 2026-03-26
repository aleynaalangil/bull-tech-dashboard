import * as Sentry from '@sentry/react';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { logger } from './logger.ts'

// Sentry is only active when VITE_SENTRY_DSN is set.
// In development leave it unset to avoid polluting the project with noise.
// In production set it in the Vercel environment variables dashboard.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
    Sentry.init({
        dsn: sentryDsn,
        environment: import.meta.env.MODE,
        // Capture 10 % of transactions for performance monitoring.
        tracesSampleRate: 0.1,
        // Replay 1 % of sessions; 100 % of sessions with an error.
        replaysSessionSampleRate: 0.01,
        replaysOnErrorSampleRate: 1.0,
    });
    logger.info('Sentry initialized', { environment: import.meta.env.MODE });
} else {
    logger.debug('Sentry DSN not set — error tracking disabled');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

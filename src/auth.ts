const TOKEN_KEY = 'exchange_token';
const USER_KEY  = 'exchange_user';

export interface AuthUser {
  user_id: string;
  username: string;
  role: 'admin' | 'trader';
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthUser; } catch { return null; }
}

export function saveAuth(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

/** Base URL for the exchange-sim API */
export const EXCHANGE_URL: string = (() => {
  const url = import.meta.env.VITE_EXCHANGE_URL as string | undefined;
  if (!url) throw new Error('VITE_EXCHANGE_URL is not set');
  return url;
})();

/** Authenticated fetch — injects bearer token automatically */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  return fetch(`${EXCHANGE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

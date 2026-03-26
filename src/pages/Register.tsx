import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { EXCHANGE_URL, saveAuth } from '../auth';
import type { AuthUser } from '../auth';

export default function Register() {
  const navigate = useNavigate();
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${EXCHANGE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Registration failed');
        return;
      }

      saveAuth(data.token, {
        user_id:  data.user_id,
        username: data.username,
        role:     data.role,
      } as AuthUser);

      navigate('/');
    } catch {
      setError('Network error — is exchange-sim running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-4xl">🐂</span>
          <h1 className="text-white text-2xl font-bold mt-2 tracking-tight">Bull Tech</h1>
          <p className="text-slate-500 text-sm mt-1">Create your trading account</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-8 flex flex-col gap-5"
        >
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Username
            </label>
            <input
              type="text"
              required
              autoFocus
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-blue-500 transition-colors"
              placeholder="choose a username"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-blue-500 transition-colors"
              placeholder="at least 6 characters"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
              Confirm Password
            </label>
            <input
              type="password"
              required
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="bg-[#1e1e2e] border border-[#2a2a3e] rounded-lg px-4 py-2.5 text-white text-sm outline-none focus:border-blue-500 transition-colors"
              placeholder="••••••••"
            />
          </div>

          <div className="bg-[#1e1e2e]/50 border border-[#2a2a3e] rounded-lg px-4 py-3 text-slate-500 text-xs">
            New accounts start with <span className="text-slate-300 font-mono">10,000 USDC</span> for trading.
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-bold tracking-wide transition-colors mt-2"
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>

          <p className="text-center text-slate-500 text-xs">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-400 hover:text-blue-300 transition-colors">
              Sign in
            </Link>
          </p>
        </form>

      </div>
    </div>
  );
}

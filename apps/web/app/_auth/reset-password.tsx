import { AlertCircle, CheckCircle2, Loader2, Lock } from 'lucide-react';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useLayoutEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { getApiUrl } from '@/lib/utils';
import { createMeta } from '@/lib/seo';

export const Route = createFileRoute('/_auth/reset-password')({
  head: () => ({
    meta: createMeta({
      title: 'Reset password',
      description: 'Set a new password for your Sigmagit account.',
      noIndex: true,
    }),
  }),
  component: ResetPasswordPage,
  // Query support is retained for already-issued links and removed immediately on mount.
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
});

function ResetPasswordPage() {
  const { token: tokenFromSearch } = Route.useSearch();
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    const nextToken = fragmentToken || tokenFromSearch;
    setToken(nextToken);
    if (nextToken) window.history.replaceState(null, '', window.location.pathname);
  }, [tokenFromSearch]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    if (password.length > 128) {
      toast.error('Password must be at most 128 characters');
      return;
    }

    if (!token) {
      setError('Invalid or missing reset token');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${getApiUrl()}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to reset password');
        return;
      }

      setToken('');
      setSuccess(true);
      toast.success('Password reset successfully');
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (!token && !tokenFromSearch) {
    return (
      <div className="w-full">
        <div className="border-border bg-card rounded-lg border p-8 shadow-sm">
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="bg-destructive/10 p-3">
                <AlertCircle className="text-destructive size-8" />
              </div>
            </div>
            <h1 className="mb-2 text-xl font-semibold">Invalid reset link</h1>
            <p className="text-muted-foreground mb-6 text-sm">
              This password reset link is invalid or has expired.
            </p>
            <Button asChild className="w-full">
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="w-full">
        <div className="border-border bg-card rounded-lg border p-8 shadow-sm">
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="bg-green-500/10 p-3">
                <CheckCircle2 className="size-8 text-green-500" />
              </div>
            </div>
            <h1 className="mb-2 text-xl font-semibold">Password reset complete</h1>
            <p className="text-muted-foreground mb-6 text-sm">
              Your password has been reset successfully. You can now sign in with your new password.
            </p>
            <Button asChild className="w-full">
              <Link to="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full">
        <div className="border-border bg-card rounded-lg border p-8 shadow-sm">
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="bg-destructive/10 p-3">
                <AlertCircle className="text-destructive size-8" />
              </div>
            </div>
            <h1 className="mb-2 text-xl font-semibold">Reset failed</h1>
            <p className="text-muted-foreground mb-6 text-sm">{error}</p>
            <Button asChild className="w-full">
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="border-border bg-card rounded-lg border p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="bg-muted p-3">
              <Lock className="text-muted-foreground size-6" />
            </div>
          </div>
          <h1 className="text-xl font-semibold">Create new password</h1>
          <p className="text-muted-foreground mt-2 text-sm">Enter your new password below.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              className="h-10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              className="h-10"
            />
          </div>
          <Button type="submit" disabled={loading} className="h-10 w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Resetting...
              </>
            ) : (
              'Reset password'
            )}
          </Button>
        </form>
      </div>
      <div className="border-border mt-6 border p-4 text-center">
        <p className="text-muted-foreground text-sm">
          Remember your password?{' '}
          <Link to="/login" className="text-foreground font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

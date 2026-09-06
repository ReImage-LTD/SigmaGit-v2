import { useEffect, useState } from "react";
import { ArrowRight, Fingerprint, Loader2, Lock, Mail } from "lucide-react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Github } from '@/components/brand-icons';
import { authClient, signIn } from "@/lib/auth-client";
import { createMeta } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { NostrAuthButton } from "@/components/nostr-auth-button";

export const Route = createFileRoute("/_auth/login")({
  head: () => ({ meta: createMeta({ title: "Log in", description: "Log in to your Sigmagit account.", noIndex: true }) }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    void PublicKeyCredential.isConditionalMediationAvailable()
      .then((available) => {
        if (available) {
          void authClient.signIn.passkey({ autoFill: true });
        }
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await signIn.email({
        email,
        password,
      });

      if (error) {
        toast.error(error.message || "Failed to sign in");
        return;
      }

      toast.success("Welcome back!");
      navigate({ to: "/" });
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskeySignIn() {
    setPasskeyLoading(true);

    try {
      const { error } = await authClient.signIn.passkey();

      if (error) {
        toast.error(error.message || "Failed to sign in with passkey");
        return;
      }

      toast.success("Welcome back!");
      navigate({ to: "/" });
    } catch (err) {
      if (err instanceof Error && err.name !== "NotAllowedError") {
        toast.error("Something went wrong");
      }
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleGithubSignIn() {
    setGithubLoading(true);
    try {
      const { error } = await authClient.signIn.social({
        provider: "github",
      });

      if (error) {
        toast.error(error.message || "Failed to sign in with GitHub");
      }
    } catch {
      toast.error("Failed to start GitHub sign in");
    } finally {
      setGithubLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <Card className="border-border/50 shadow-xl shadow-primary/5">
        <CardHeader className="space-y-1 text-center pb-6">
          <div className="mx-auto size-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center text-primary-foreground font-bold text-xl shadow-lg shadow-primary/20 mb-4">
            σ
        </div>
          <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
          <CardDescription>
            Sign in to your account to continue
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
                  className="pl-10 h-11"
            />
          </div>
            </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                Forgot password?
              </Link>
            </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
                  className="pl-10 h-11"
            />
          </div>
            </div>

            <Button
              type="submit"
              disabled={loading || passkeyLoading}
              className="w-full h-11 text-base"
            >
            {loading ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Signing in...
              </>
            ) : (
                <>
                  Sign in
                  <ArrowRight className="size-4 ml-2" />
                </>
            )}
          </Button>
        </form>

          <div className="relative">
          <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/50" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handlePasskeySignIn}
              disabled={loading || passkeyLoading}
              className="h-11"
            >
          {passkeyLoading ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
              <Fingerprint className="size-4 mr-2" />
              )}
              Passkey
            </Button>

            <NostrAuthButton
              variant="outline"
              className="h-11"
              onSuccess={() => navigate({ to: "/" })}
            />

            <Button
              type="button"
              variant="outline"
              onClick={handleGithubSignIn}
              disabled={loading || passkeyLoading || githubLoading}
              className="h-11"
            >
              {githubLoading ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Github className="size-4 mr-2" />
              )}
              GitHub
            </Button>
      </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-4 pt-2">
          <div className="text-center text-sm text-muted-foreground">
          New to sigmagit?{" "}
            <Link
              to="/register"
              className="text-primary hover:underline font-medium transition-colors"
            >
            Create an account
          </Link>
          </div>
        </CardFooter>
      </Card>

      {/* Trust badges */}
      <div className="mt-8 flex items-center justify-center gap-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <div className="size-2 rounded-full bg-green-500" />
          Secure SSL
        </span>
        <span className="flex items-center gap-1.5">
          <div className="size-2 rounded-full bg-green-500" />
          Encrypted
        </span>
        <span className="flex items-center gap-1.5">
          <div className="size-2 rounded-full bg-green-500" />
          GDPR Ready
        </span>
      </div>
    </div>
  );
}

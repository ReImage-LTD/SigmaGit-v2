import { useState } from "react";
import { Loader2 } from "lucide-react";
import { validateUsername } from "@sigmagit/lib";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { signIn } from "@/lib/auth-client";
import { createMeta } from "@/lib/seo";
import { getApiUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_auth/setup")({
  head: () => ({ meta: createMeta({ title: "Set up sigmagit", description: "Create the admin account for your sigmagit instance.", noIndex: true }) }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    try {
      const res = await fetch(`${getApiUrl()}/api/status`);
      const data = await res.json();
      if (!data?.needsSetup) {
        throw redirect({ to: "/" });
      }
    } catch (err) {
      // Re-throw redirects; ignore network errors so the page can still render.
      if (err && typeof err === "object" && "to" in err) throw err;
    }
  },
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const usernameValidation = validateUsername(formData.username);
    if (!usernameValidation.valid) {
      toast.error(usernameValidation.error);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${getApiUrl()}/api/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: formData.name,
          username: formData.username.toLowerCase(),
          email: formData.email,
          password: formData.password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to create admin account");
        return;
      }

      const { error } = await signIn.email({
        email: formData.email,
        password: formData.password,
      });

      if (error) {
        toast.success("Admin account created. Please sign in.");
        navigate({ to: "/login" });
        return;
      }

      toast.success("Admin account created!");
      navigate({ to: "/" });
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <div className="border border-border bg-card rounded-lg p-8 shadow-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-2">Welcome to sigmagit</h1>
          <p className="text-sm text-muted-foreground">Create the admin account to finish setting up your instance</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="John Doe"
              autoComplete="name"
              required
              className="h-10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              placeholder="admin"
              autoComplete="username"
              required
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">This will be the admin&apos;s unique identifier on sigmagit</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className="h-10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              minLength={8}
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
          </div>
          <Button type="submit" variant="default" disabled={loading} className="w-full h-10">
            {loading ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Creating admin account...
              </>
            ) : (
              "Create admin account"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

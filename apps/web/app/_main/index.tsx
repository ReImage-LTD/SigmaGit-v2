import { useState } from "react";
import { ArrowRight, BookOpen, Code2, GitBranch, Loader2, Plus, Settings, Shield, Sparkles, Terminal, User, Zap } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useCurrentUserSummary, usePlatformStats, useUserRepositories } from "@sigmagit/hooks";
import { Github } from '@/components/brand-icons';
import { createMeta } from "@/lib/seo";
import RepositoryCard from "@/components/repository-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { NewRepositoryModal } from "@/components/new-repository-modal";

export const Route = createFileRoute("/_main/")({
  head: () => ({ meta: createMeta({ title: "Home", description: "Sigmagit — where code lives. Git hosting, pull requests, issues, and team collaboration." }) }),
  component: HomePage,
});

function HomePage() {
  const { data: session, isPending: sessionLoading } = useSession();

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-10 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return <LandingPage />;
  }

  return <LoggedInHomePage session={session} />;
}

function LoggedInHomePage({ session }: { session: { user: { username?: string;[key: string]: any };[key: string]: any } }) {
  const username = session.user.username || "";
  const { data: user, isLoading: userLoading } = useCurrentUserSummary(!!session.user);
  const { data, isLoading: reposLoading } = useUserRepositories(username);
  const [newRepoModalOpen, setNewRepoModalOpen] = useState(false);

  const repos = data?.repos || [];

  return (
    <div className="container">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar */}
        <aside className="lg:w-72 shrink-0 space-y-6">
          {/* User Card */}
          <Card className="overflow-hidden">
            <div className="h-24 bg-gradient-to-br from-primary/20 to-primary/5" />
            <CardContent className="-mt-12 pb-6">
          {userLoading ? (
                <div className="animate-pulse">
                  <div className="size-20 rounded-full bg-muted mb-3" />
                  <div className="h-5 w-32 bg-muted rounded mb-2" />
                  <div className="h-4 w-24 bg-muted rounded" />
            </div>
          ) : (
                <>
                  <Avatar className="size-20 rounded-full border-4 border-background shadow-lg">
                <AvatarImage src={user?.avatarUrl || undefined} />
                    <AvatarFallback className="bg-gradient-to-br from-muted to-muted/50 text-muted-foreground font-bold text-2xl">
                      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
                  <div className="mt-3">
                    <h2 className="font-bold text-lg">{user?.name}</h2>
                    <p className="text-muted-foreground text-sm">@{username}</p>
              </div>
                  <div className="mt-4 flex gap-2">
                    <Link to="/$username" params={{ username }} className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">
                        View profile
                      </Button>
                    </Link>
                    <Link to="/settings" className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">
                        Settings
                      </Button>
                    </Link>
            </div>
                </>
          )}
            </CardContent>
          </Card>

          {/* Quick Links */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <QuickLink icon={<BookOpen className="size-4" />} label="Your repositories" href="/$username" params={{ username }} />
              <QuickLink icon={<Zap className="size-4" />} label="Explore" href="/explore" />
              <QuickLink icon={<Sparkles className="size-4" />} label="Starred" href="/$username?tab=stars" params={{ username }} />
              <QuickLink icon={<Settings className="size-4" />} label="Settings" href="/settings" />
            </CardContent>
          </Card>
        </aside>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold">Your repositories</h2>
              <p className="text-muted-foreground text-sm mt-1">
                {repos.length} {repos.length === 1 ? "repository" : "repositories"}
              </p>
            </div>
            <Button onClick={() => setNewRepoModalOpen(true)} className="gap-2">
              <Plus className="size-4" />
              New repository
            </Button>
          </div>

          {userLoading || reposLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <RepositoryCardSkeleton key={i} />
              ))}
            </div>
          ) : repos.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <GitBranch className="size-8 text-primary" />
                </div>
              <h3 className="text-lg font-semibold mb-2">No repositories yet</h3>
                <p className="text-muted-foreground mb-6 max-w-sm">
                  Create your first repository to start building something awesome
                </p>
                <Button size="lg" className="gap-2" onClick={() => setNewRepoModalOpen(true)}>
                  <Plus className="size-4" />
                Create repository
              </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {repos.map((repo) => (
                <RepositoryCard key={repo.id} repository={repo} />
              ))}
            </div>
          )}
        </div>
      </div>

      <NewRepositoryModal open={newRepoModalOpen} onOpenChange={setNewRepoModalOpen} />
    </div>
  );
}

function QuickLink({ icon, label, href, params }: { icon: React.ReactNode; label: string; href: string; params?: Record<string, string> }) {
  return (
    <Link
      to={href}
      params={params}
      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function RepositoryCardSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className="size-10 rounded-lg bg-muted shrink-0" />
          <div className="flex-1 space-y-3">
            <div className="h-5 w-48 bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-3/4 bg-muted rounded" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LandingPage() {
  const { data: platformStats, isLoading: statsLoading } = usePlatformStats();

  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  const stats = [
    {
      number:
        statsLoading && !platformStats ? "..." : formatCompactNumber(platformStats?.repositories ?? 0),
      label: "Public Repositories",
    },
    {
      number:
        statsLoading && !platformStats ? "..." : formatCompactNumber(platformStats?.developers ?? 0),
      label: "Developers",
    },
    {
      number:
        statsLoading && !platformStats ? "..." : formatCompactNumber(platformStats?.organizations ?? 0),
      label: "Organizations",
    },
    {
      number:
        statsLoading && !platformStats ? "..." : formatUptime(platformStats?.uptimeSeconds ?? 0),
      label: "Server Uptime",
    },
  ];
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <section className="relative py-20 lg:py-32 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,119,198,0.15),transparent)]" />

        <div className="container relative">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/20 bg-primary/5 text-primary mb-8">
              <Sparkles className="size-4" />
              <span className="text-sm font-medium">Now with AI-powered code review</span>
          </div>

            {/* Heading */}
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold mb-6 bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent tracking-tight">
              Where code lives
          </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            A modern Git hosting platform built for developers. Host your code, collaborate with your team, and ship faster.
          </p>

            {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link to="/register">
                <Button size="lg" className="h-14 px-8 text-lg gap-2 w-full sm:w-auto">
                  Get started for free
                  <ArrowRight className="size-5" />
                </Button>
            </Link>
            <Link to="/login">
                <Button size="lg" variant="outline" className="h-14 px-8 text-lg w-full sm:w-auto">
                  Sign in
                </Button>
            </Link>
          </div>

            {/* Code preview card */}
            <div className="relative mx-auto max-w-3xl">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-purple-500/20 to-primary/20 rounded-2xl blur-2xl opacity-50" />
              <Card className="relative border-border/50 shadow-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-muted/30">
                  <div className="flex gap-1.5">
                    <div className="size-3 rounded-full bg-red-500/80" />
                    <div className="size-3 rounded-full bg-yellow-500/80" />
                    <div className="size-3 rounded-full bg-green-500/80" />
                  </div>
                  <div className="flex-1 text-center">
                    <span className="text-xs text-muted-foreground">terminal</span>
                  </div>
              </div>
                <CardContent className="p-6 text-left font-mono text-sm">
                  <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-primary">$</span>
                  <span className="text-foreground">git clone git@sigmagit.com:username/repo.git</span>
                </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">Cloning into 'repo'...</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">remote: Enumerating objects: 100, done.</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-primary">$</span>
                      <span className="text-foreground">cd repo</span>
                    </div>
                <div className="flex items-center gap-2">
                  <span className="text-primary">$</span>
                      <span className="text-muted-foreground"># Start building something amazing...</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-primary">$</span>
                      <span className="animate-pulse">_</span>
                </div>
              </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 lg:py-32 bg-muted/30">
        <div className="container">
          <div className="text-center mb-16">
            <Badge variant="secondary" className="mb-4">Features</Badge>
            <h2 className="text-4xl md:text-5xl font-bold mb-4">Everything you need</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Powerful features to help you build, collaborate, and ship faster
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={<GitBranch className="size-6" />}
              title="Git Hosting"
              description="Full Git support with SSH and HTTPS. Clone, push, and pull just like you're used to."
            />
            <FeatureCard
              icon={<Code2 className="size-6" />}
              title="Pull Requests"
              description="Review code, discuss changes, and merge with confidence. Built-in code review tools."
            />
            <FeatureCard
              icon={<BookOpen className="size-6" />}
              title="Issues & Discussions"
              description="Track bugs, plan features, and discuss ideas. Keep your team aligned and organized."
            />
            <FeatureCard
              icon={<User className="size-6" />}
              title="Team Collaboration"
              description="Work together seamlessly with fine-grained permissions and team management."
            />
            <FeatureCard
              icon={<Shield className="size-6" />}
              title="Security First"
              description="Enterprise-grade security with 2FA, SSO, and advanced access controls."
            />
            <FeatureCard
              icon={<Terminal className="size-6" />}
              title="CI/CD Integration"
              description="Connect with your favorite CI/CD tools. Automate your workflow from code to deployment."
            />
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 lg:py-32">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8" style={{ minHeight: '80px' }}>
            {stats.map((stat) => (
              <StatCard key={stat.label} number={stat.number} label={stat.label} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 lg:py-32 bg-muted/30">
        <div className="container">
          <div className="relative rounded-3xl bg-gradient-to-br from-primary/10 via-primary/5 to-background p-12 lg:p-16 text-center overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
            <div className="relative">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">Ready to get started?</h2>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join thousands of developers already using sigmagit to build amazing things.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register">
                  <Button size="lg" className="h-14 px-8 text-lg w-full sm:w-auto">
                    Create your account
                  </Button>
            </Link>
            <Link to="/explore">
                  <Button size="lg" variant="outline" className="h-14 px-8 text-lg w-full sm:w-auto">
                    Explore repositories
                  </Button>
            </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Card className="group hover:shadow-lg hover:border-primary/20 transition-all duration-300">
      <CardContent className="p-6">
        <div className="size-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform duration-300">
          {icon}
        </div>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  );
}

function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-4xl md:text-5xl font-bold bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent mb-2">
        {number}
      </div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

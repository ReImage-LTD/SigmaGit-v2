'use client';

import {
  BarChart3,
  Briefcase,
  Building2,
  ChevronRight,
  FileCode,
  FileText,
  Flag,
  FolderGit2,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useAdminDmcaCounts, useAdminReportsCounts, useCurrentUserSummary } from '@sigmagit/hooks';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { signOut, useSession } from '@/lib/auth-client';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function AdminLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { data: session } = useSession();
  const { data: user } = useCurrentUserSummary(!!session?.user);
  const { data: reportsCounts } = useAdminReportsCounts();
  const { data: dmcaCounts } = useAdminDmcaCounts();

  const navItems = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', description: 'Overview & stats' },
    { to: '/admin/stats', icon: BarChart3, label: 'Stats', description: 'Uptime, API & Postgres' },
    { to: '/admin/users', icon: Users, label: 'Users', description: 'Manage accounts' },
    {
      to: '/admin/repositories',
      icon: FolderGit2,
      label: 'Repositories',
      description: 'All repos',
    },
    {
      to: '/admin/organizations',
      icon: Building2,
      label: 'Organizations',
      description: 'Teams & orgs',
    },
    { to: '/admin/gists', icon: FileCode, label: 'Gists', description: 'Code snippets' },
    {
      to: '/admin/applications',
      icon: Briefcase,
      label: 'Applications',
      description: 'Jobs & career applications',
    },
    {
      to: '/admin/audit-logs',
      icon: FileText,
      label: 'Audit Logs',
      description: 'Activity tracking',
    },
    {
      to: '/admin/reports',
      icon: Flag,
      label: 'Reports',
      description: 'User & content reports',
      countsKey: 'reports',
    },
    {
      to: '/admin/dmca',
      icon: ShieldAlert,
      label: 'DMCA',
      description: 'Copyright takedowns',
      countsKey: 'dmca',
    },
    { to: '/admin/runners', icon: Server, label: 'Runners', description: 'CI/CD runner agents' },
    { to: '/admin/utils', icon: Wrench, label: 'Utils', description: 'Cleanup & maintenance' },
    { to: '/admin/settings', icon: Settings, label: 'Settings', description: 'System config' },
  ];

  return (
    <div className="bg-background flex min-h-screen flex-col">
      {/* Mobile Header */}
      <div className="border-border bg-card sticky top-0 z-40 flex items-center justify-between border-b px-4 py-3 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="from-primary to-primary/70 rounded-lg bg-gradient-to-br p-2">
            <Shield className="text-primary-foreground size-4" />
          </div>
          <span className="text-sm font-bold">Admin Panel</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(true)}>
          <Menu className="size-5" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Mobile Sidebar Overlay */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="bg-background/80 absolute inset-0 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside className="border-border bg-card animate-in slide-in-from-left absolute top-0 left-0 h-full w-72 flex-shrink-0 flex-col border-r">
              {/* Header */}
              <div className="border-border flex items-center justify-between border-b p-4">
                <div className="flex items-center gap-3">
                  <div className="from-primary to-primary/70 rounded-lg bg-gradient-to-br p-2">
                    <Shield className="text-primary-foreground size-5" />
                  </div>
                  <div>
                    <h1 className="font-bold">Admin Panel</h1>
                    <p className="text-muted-foreground text-xs">Platform Management</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                  <X className="size-5" />
                </Button>
              </div>
              {/* Navigation */}
              <nav className="flex-1 space-y-1 overflow-y-auto p-3">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    location.pathname === item.to ||
                    (item.to !== '/admin' && location.pathname.startsWith(item.to));
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
              {/* Footer */}
              <div className="border-border border-t p-4">
                {user && (
                  <div className="bg-muted/50 flex items-center gap-3 rounded-xl p-3">
                    <Avatar className="size-9">
                      <AvatarImage src={user.avatarUrl ?? undefined} />
                      <AvatarFallback className="from-muted to-muted/50 bg-gradient-to-br text-sm font-semibold">
                        {user.name.charAt(0) || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user.name}</p>
                      <p className="text-muted-foreground truncate text-xs">Administrator</p>
                    </div>
                  </div>
                )}
                <Button
                  variant="ghost"
                  className="text-muted-foreground mt-3 w-full justify-start gap-2"
                  onClick={() => signOut()}
                >
                  <LogOut className="size-4" />
                  <span>Sign out</span>
                </Button>
              </div>
            </aside>
          </div>
        )}

        {/* Desktop Sidebar */}
        <aside className="border-border bg-card sticky top-0 hidden h-screen w-64 flex-shrink-0 flex-col border-r lg:flex xl:w-72">
          {/* Header */}
          <div className="border-border border-b p-5 xl:p-6">
            <div className="flex items-center gap-3">
              <div className="from-primary to-primary/70 shadow-primary/20 rounded-xl bg-gradient-to-br p-2.5 shadow-lg">
                <Shield className="text-primary-foreground size-5" />
              </div>
              <div>
                <h1 className="text-lg font-bold">Admin Panel</h1>
                <p className="text-muted-foreground text-xs">Platform Management</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 overflow-y-auto p-3 xl:p-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                location.pathname === item.to ||
                (item.to !== '/admin' && location.pathname.startsWith(item.to));
              const pendingCount =
                'countsKey' in item && item.countsKey === 'reports'
                  ? (reportsCounts?.pending ?? 0)
                  : 'countsKey' in item && item.countsKey === 'dmca'
                    ? (dmcaCounts?.pending ?? 0)
                    : 0;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <div
                    className={cn(
                      'rounded-lg p-2 transition-colors',
                      isActive ? 'bg-primary-foreground/20' : 'bg-muted group-hover:bg-accent',
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{item.label}</span>
                      {pendingCount > 0 && (
                        <Badge
                          variant={isActive ? 'secondary' : 'destructive'}
                          className="shrink-0 px-1.5 py-0 text-xs"
                        >
                          {pendingCount}
                        </Badge>
                      )}
                    </div>
                    <div
                      className={cn(
                        'text-xs',
                        isActive ? 'text-primary-foreground/70' : 'text-muted-foreground',
                      )}
                    >
                      {item.description}
                    </div>
                  </div>
                  <ChevronRight
                    className={cn(
                      'size-4 shrink-0 transition-transform',
                      isActive ? 'opacity-100' : '-translate-x-2 opacity-0',
                    )}
                  />
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="border-border space-y-3 border-t p-4">
            <Link to="/">
              <Button variant="outline" className="h-11 w-full justify-start gap-2">
                <Home className="size-4" />
                Back to Site
              </Button>
            </Link>

            {user && (
              <div className="bg-muted/50 flex items-center gap-3 rounded-xl p-3">
                <Avatar className="size-9">
                  <AvatarImage src={user.avatarUrl || undefined} />
                  <AvatarFallback className="from-muted to-muted/50 bg-gradient-to-br text-sm font-semibold">
                    {user.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="text-muted-foreground truncate text-xs">Administrator</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => signOut()}
                >
                  <LogOut className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

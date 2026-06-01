import { useEffect, useState } from "react";
import { HeadContent, Link, Outlet, Scripts, createRootRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { Databuddy } from "@databuddy/sdk/react";
import { GitBranch, Home } from "lucide-react";
import { ThemeProvider } from "tanstack-theme-kit";
import appCss from "./globals.css?url";
import type { ReactNode } from "react";
import { MaintenancePage } from "@/components/maintenance-page";
import { useSession } from "@/lib/auth-client";
import { defaultMeta } from "@/lib/seo";
import { getApiUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--tw-gradient-stops))] from-destructive/10 via-transparent to-transparent" />
      <div className="relative text-center">
        <GitBranch className="size-16 mx-auto mb-6 text-muted-foreground" />
        <h1 className="text-7xl font-bold text-foreground mb-2">404</h1>
        <h2 className="text-2xl font-semibold mb-4">Page not found</h2>
        <p className="text-muted-foreground mb-8 max-w-md">The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have permission to view it.</p>
        <Button
          render={() => (
            <Link to="/" className="gap-2">
              <Home className="size-4" />
              Go home
            </Link>
          )}
        />
      </div>
    </div>
  );
}

function LazyDatabuddy({ clientId }: { clientId: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) return null;

  return (
    <Databuddy
      clientId={clientId}
      trackHashChanges={true}
      trackAttributes={true}
      trackOutgoingLinks={true}
      trackInteractions={true}
      trackScrollDepth={true}
      trackWebVitals={true}
      trackErrors={true}
    />
  );
}

function MaintenanceGate({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Defer status check to not block initial render
    const timer = setTimeout(() => {
      fetch(`${getApiUrl()}/api/status`)
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          setMaintenanceMode(data.maintenanceMode === true);
          // First-run install: route everyone to /setup until an account exists.
          if (data.needsSetup === true && pathname !== "/setup") {
            navigate({ to: "/setup" });
          }
        })
        .catch(() => {
          if (!cancelled) setMaintenanceMode(false);
        })
        .finally(() => {
          if (!cancelled) setChecked(true);
        });
    }, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [navigate, pathname]);

  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  if (!checked) {
    return <>{children}</>;
  }
  if (maintenanceMode && !isAdmin) {
    return <MaintenancePage />;
  }
  return <>{children}</>;
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      ...defaultMeta,
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        href: "/favicon.ico",
      },
    ],
  }),
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  const databuddyClientId = import.meta.env.VITE_DATABUDDY_CLIENT_ID;
  const enableDatabuddy =
    import.meta.env.PROD
    && import.meta.env.VITE_ENABLE_DATABUDDY === "true"
    && Boolean(databuddyClientId);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <MaintenanceGate>
            <Outlet />
          </MaintenanceGate>
          <Toaster richColors position="top-right" />
          {enableDatabuddy ? (
            <LazyDatabuddy clientId={databuddyClientId} />
          ) : null}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

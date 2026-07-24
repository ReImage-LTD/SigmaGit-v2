import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { AdminLayout } from '@/components/admin/layout';
import { authClient } from '@/lib/auth-client';
import { createMeta } from '@/lib/seo';

export const Route = createFileRoute('/_main/admin')({
  beforeLoad: async () => {
    if (typeof window === 'undefined') return;
    const { data } = await authClient.getSession();
    if (!data?.session) {
      throw redirect({ to: '/' });
    }
    const role = (data.user as { role?: string } | undefined)?.role;
    if (role !== 'admin') {
      throw redirect({ to: '/' });
    }
  },
  head: () => ({
    meta: createMeta({
      title: 'Admin Panel',
      description:
        'Administrative dashboard for managing users, repositories, organizations, and system settings.',
      noIndex: true,
    }),
  }),
  component: () => (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  ),
});

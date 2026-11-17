import { Sidebar } from '@/components/layout/sidebar';
import { LogoutButton } from '@/components/logout-button';
import { ErrorNotice } from '@/components/admin/page-state';
import { getMe } from '@/lib/api/me';
import { navItemsFor } from '@/lib/navigation';

/** Authenticated shell. Navigation is derived from `GET /me`; the API remains the authority. */
export default async function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me.ok) {
    return (
      <main className="p-6">
        <ErrorNotice message={me.message} />
      </main>
    );
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar items={navItemsFor(me.data.permissions)} />
      <div className="flex-1">
        <header className="flex items-center justify-between border-b px-6 py-3 text-sm">
          <span>
            {me.data.user.displayName} · {me.data.tenant.name}
          </span>
          <LogoutButton />
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

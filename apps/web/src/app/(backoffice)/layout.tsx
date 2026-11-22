import { ErrorNotice } from '@/components/admin/page-state';
import { Brand, MobileNav, Sidebar } from '@/components/layout/sidebar';
import { LogoutButton } from '@/components/logout-button';
import { getMe } from '@/lib/api/me';
import { navItemsFor } from '@/lib/navigation';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');

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
  const items = navItemsFor(me.data.permissions);
  const { user, tenant } = me.data;
  return (
    <div className="flex min-h-screen">
      <Sidebar items={items} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/80 px-4 backdrop-blur md:px-8">
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2.5 text-sm">
              <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {initials(user.displayName)}
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block font-medium">{user.displayName}</span>
                <span className="block text-xs text-muted-foreground">{tenant.name}</span>
              </span>
            </div>
            <LogoutButton />
          </div>
        </header>
        <MobileNav items={items} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

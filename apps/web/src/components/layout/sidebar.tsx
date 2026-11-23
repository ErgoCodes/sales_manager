import { Store } from 'lucide-react';
import Link from 'next/link';
import type { NavItem } from '@/lib/navigation';
import { NavLinks } from './nav-links';

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md font-semibold tracking-tight whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span aria-hidden className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Store className="size-4" />
      </span>
      Mercado Mónaco
    </Link>
  );
}

/** Desktop navigation (md and up); `MobileNav` is the small-screen equivalent. */
export function Sidebar({ items }: { items: readonly NavItem[] }) {
  return (
    <aside aria-label="Navegación principal" className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-4 md:flex">
      <div className="px-2.5">
        <Brand />
      </div>
      <nav>
        <NavLinks items={items} orientation="vertical" />
      </nav>
    </aside>
  );
}

export function MobileNav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav aria-label="Navegación principal" className="overflow-x-auto border-b px-4 py-2 [scrollbar-width:none] md:hidden">
      <NavLinks items={items} orientation="horizontal" />
    </nav>
  );
}

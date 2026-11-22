'use client';

import { Boxes, ChartColumn, House, Package, ScrollText, ShieldCheck, Smartphone, Store, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  '/': House,
  '/tablero': ChartColumn,
  '/puntos-de-venta': Store,
  '/catalogo': Package,
  '/inventario': Boxes,
  '/usuarios': Users,
  '/roles': ShieldCheck,
  '/dispositivos': Smartphone,
  '/auditoria': ScrollText,
};

/** An entry is active on its own path and below it (`/inventario/entrada` keeps "Inventario" active). */
export function isActive(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The navigation entries, vertical in the sidebar and horizontal (scrollable) on small screens.
 * A client component only to read the current path for `aria-current`.
 */
export function NavLinks({ items, orientation }: { items: readonly NavItem[]; orientation: 'vertical' | 'horizontal' }) {
  const pathname = usePathname();
  const vertical = orientation === 'vertical';
  return (
    <ul className={cn(vertical ? 'space-y-0.5' : 'flex gap-1')}>
      {items.map((item) => {
        const Icon = ICONS[item.href];
        const active = isActive(item.href, pathname);
        return (
          <li key={item.href} className={vertical ? undefined : 'shrink-0'}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                'aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground',
                vertical ? 'px-2.5 py-2' : 'px-3 py-1.5',
              )}
            >
              {Icon ? <Icon aria-hidden className="size-4 shrink-0" /> : null}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

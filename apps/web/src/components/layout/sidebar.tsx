import Link from 'next/link';
import type { NavItem } from '@/lib/navigation';

export function Sidebar({ items }: { items: readonly NavItem[] }) {
  return (
    <aside aria-label="Navegación principal" className="hidden w-60 shrink-0 border-r bg-muted/40 p-4 md:block">
      <p className="mb-4 text-lg font-semibold">Mercado Mónaco</p>
      <nav>
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="block rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface SegmentedLink {
  key: string;
  href: string;
  label: string;
  active: boolean;
}

/**
 * A segmented control made of links: the URL is the state, so each option is a plain link and the
 * selected one carries `aria-current="page"`. Works without client JS.
 */
export function SegmentedLinks({ label, items, className }: { label: string; items: readonly SegmentedLink[]; className?: string }) {
  return (
    <nav aria-label={label} className={cn('inline-flex rounded-lg bg-muted p-0.5', className)}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1 text-sm whitespace-nowrap text-muted-foreground outline-none transition-[color,background-color,box-shadow] duration-150 ease-out hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'aria-[current=page]:bg-background aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:shadow-sm',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

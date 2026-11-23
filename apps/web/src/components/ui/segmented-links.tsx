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
/** `scroll={false}` keeps the scroll position: use it when the options only change the surrounding card. */
export function SegmentedLinks({ label, items, className, scroll }: { label: string; items: readonly SegmentedLink[]; className?: string; scroll?: boolean }) {
  return (
    <nav aria-label={label} className={cn('inline-flex rounded-lg bg-muted p-0.5', className)}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          scroll={scroll}
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

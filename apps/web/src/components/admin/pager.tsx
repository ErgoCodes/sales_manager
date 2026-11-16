import Link from 'next/link';

/** Cursor pagination links. GET only: they read, never mutate. */
export function Pager({ basePath, nextCursor, extraQuery }: { basePath: string; nextCursor: string | null; extraQuery?: Record<string, string> }) {
  const query = (cursor?: string) => {
    const params = new URLSearchParams(extraQuery);
    if (cursor) params.set('cursor', cursor);
    const s = params.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav aria-label="Paginación" className="flex gap-3 text-sm">
      <Link href={query()} className="underline">
        Primera página
      </Link>
      {nextCursor ? (
        <Link href={query(nextCursor)} className="underline">
          Siguiente
        </Link>
      ) : null}
    </nav>
  );
}

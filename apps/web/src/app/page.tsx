import { connection } from 'next/server';
import { Suspense } from 'react';
import { HealthStatus } from '@/components/health-status';
import { fetchHealth } from '@/lib/api/health';

// Caching decision (Next 16, cacheComponents): the status must be live, so it is
// NOT wrapped in `use cache`. The fetch runs at request time inside <Suspense>;
// the static shell (title + fallback) is prerendered and the result streams in.
async function Health() {
  // Opt out of prerendering: without this, a build with the API down would bake the error state into the shell.
  await connection();
  return <HealthStatus result={await fetchHealth()} />;
}

export default function HomePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Estado del sistema</h1>
      <Suspense fallback={<p className="text-sm opacity-70">Consultando la API…</p>}>
        <Health />
      </Suspense>
    </div>
  );
}

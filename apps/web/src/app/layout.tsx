import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { NonceProvider } from '@/components/nonce-provider';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Mercado Mónaco', template: '%s · Mercado Mónaco' },
  description: 'Back-office de Mercado Mónaco',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request so the CSP nonce set by src/proxy.ts reaches Next's scripts.
  await connection();
  // Set by src/proxy.ts for this request.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NonceProvider nonce={nonce}>{children}</NonceProvider>
      </body>
    </html>
  );
}

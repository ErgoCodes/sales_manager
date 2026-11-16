import type { Metadata } from 'next';
import { connection } from 'next/server';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Mercado Mónaco', template: '%s · Mercado Mónaco' },
  description: 'Back-office de Mercado Mónaco',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request so the CSP nonce set by src/proxy.ts reaches Next's scripts.
  await connection();
  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}

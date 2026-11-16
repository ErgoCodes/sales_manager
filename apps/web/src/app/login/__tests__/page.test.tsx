import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// next/link resolves the root's react 19.1 under Vitest; a plain anchor is enough to assert the entries.
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { Sidebar } from '@/components/layout/sidebar';
import LoginPage from '../page';

describe('login page', () => {
  it('renders the login form', () => {
    // Server-rendered: Testing Library resolves the root's react 19.1, the form hooks use web's 19.3.
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain('Iniciar sesión</h1>');
    expect(html).toContain('Correo electrónico');
    expect(html).toMatch(/<input[^>]*name="password"[^>]*type="password"|<input[^>]*type="password"[^>]*name="password"/);
  });

  it('renders the sidebar with the given entries', () => {
    const html = renderToStaticMarkup(<Sidebar items={[{ href: '/roles', label: 'Roles' }]} />);
    expect(html).toContain('aria-label="Navegación principal"');
    expect(html).toMatch(/<a[^>]*href="\/roles"[^>]*>Roles<\/a>/);
  });
});

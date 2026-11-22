import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// next/link resolves the root's react 19.1 under Vitest; a plain anchor is enough to assert the entries.
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/roles/nuevo' }));

import { isActive } from '@/components/layout/nav-links';
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
    expect(html).toMatch(/<a[^>]*href="\/roles"[^>]*>.*?Roles<\/a>/);
  });

  it('marks the entry of the current section, including its sub-pages', () => {
    const html = renderToStaticMarkup(<Sidebar items={[{ href: '/', label: 'Inicio' }, { href: '/roles', label: 'Roles' }]} />);
    expect(html).toMatch(/<a[^>]*href="\/roles"[^>]*aria-current="page"|<a[^>]*aria-current="page"[^>]*href="\/roles"/);
    expect(html).not.toMatch(/<a[^>]*href="\/"[^>]*aria-current="page"/);
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/', '/roles')).toBe(false);
    expect(isActive('/inventario', '/inventario/entrada')).toBe(true);
    expect(isActive('/roles', '/rolesx')).toBe(false);
  });
});

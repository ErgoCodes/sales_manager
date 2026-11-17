import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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

  it('renders the empty sidebar shell', () => {
    render(<Sidebar />);
    expect(screen.getByLabelText('Navegación principal')).toBeInTheDocument();
  });
});

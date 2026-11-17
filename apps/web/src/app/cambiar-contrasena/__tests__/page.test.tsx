import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogoutButton } from '@/components/logout-button';
import ChangePasswordPage from '../page';

describe('change password page', () => {
  it('renders the three password fields', () => {
    const html = renderToStaticMarkup(<ChangePasswordPage />);
    for (const label of ['Contraseña actual', 'Nueva contraseña', 'Confirma la nueva contraseña']) expect(html).toContain(label);
    expect(html).toContain('autoComplete="new-password"');
  });
});

describe('LogoutButton', () => {
  it('is a POST form to /logout, never a link', () => {
    const html = renderToStaticMarkup(<LogoutButton />);
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/logout"|<form[^>]*action="\/logout"[^>]*method="post"/);
    expect(html).not.toContain('<a ');
  });
});

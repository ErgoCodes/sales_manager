import { getByLabelText, getByRole, queryByRole } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderWithReact } from '../../../../vitest.render';

vi.mock('../actions', () => ({ loginAction: vi.fn(async () => ({})) }));

import { LoginForm } from '../login-form';

let view: ReturnType<typeof renderWithReact> | undefined;
afterEach(() => view?.unmount());

const ACCOUNTS = [
  { label: 'Propietario', email: 'owner@example.test', password: 'owner-secret' },
  { label: 'Encargado', email: 'manager@example.test', password: 'manager-secret' },
  { label: 'Cajero', email: 'cashier@example.test', password: 'cashier-secret' },
];

describe('LoginForm password visibility', () => {
  it('the eye button toggles the password between hidden and visible', () => {
    view = renderWithReact(<LoginForm />);
    const { container } = view;
    const input = getByLabelText(container, 'Contraseña');
    const toggle = getByRole(container, 'button', { name: 'Mostrar caracteres' });
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'password');
    act(() => toggle.click());
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    act(() => toggle.click());
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('LoginForm demo accounts (DEMO_MODE)', () => {
  it('each demo button fills the form without submitting it', () => {
    view = renderWithReact(<LoginForm demoAccounts={ACCOUNTS} />);
    const { container } = view;
    for (const account of ACCOUNTS) expect(getByRole(container, 'button', { name: new RegExp(account.label) })).toHaveAttribute('type', 'button');
    act(() => getByRole(container, 'button', { name: /Encargado/ }).click());
    expect(getByLabelText(container, 'Correo electrónico')).toHaveValue('manager@example.test');
    expect(getByLabelText(container, 'Contraseña')).toHaveValue('manager-secret');
    expect(container.textContent).toContain('Demo de solo lectura');
  });

  it('shows no demo section without accounts', () => {
    view = renderWithReact(<LoginForm />);
    expect(queryByRole(view.container, 'button', { name: /Propietario/ })).toBeNull();
    expect(view.container.textContent).not.toContain('Demo de solo lectura');
  });
});

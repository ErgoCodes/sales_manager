import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMe = vi.fn();
vi.mock('@/lib/api/me', () => ({ getMe: () => getMe() }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import BackofficeLayout from '../layout';
import { LocationFields } from '../puntos-de-venta/location-fields';
import { RoleFields } from '../roles/role-fields';
import { UserFields } from '../usuarios/user-fields';

const me = (...permissions: string[]) => ({
  ok: true,
  data: { user: { displayName: 'Ana' }, tenant: { name: 'Mónaco' }, permissions: permissions.map((permission) => ({ permission, scope: { type: 'tenant' } })) },
});
const render = async () => renderToStaticMarkup(await BackofficeLayout({ children: <p>contenido</p> }));

beforeEach(() => getMe.mockReset());

describe('BackofficeLayout', () => {
  it('shows the admin entries to an owner-like user', async () => {
    getMe.mockResolvedValue(me('users:manage', 'roles:manage', 'audit:view'));
    const out = await render();
    for (const label of ['Usuarios', 'Roles', 'Auditoría', 'Puntos de venta', 'Dispositivos', 'contenido', '>Ana<', '>Mónaco<']) expect(out).toContain(label);
  });

  it('hides them from a cashier', async () => {
    getMe.mockResolvedValue(me('sales:create'));
    const out = await render();
    for (const label of ['Usuarios', 'Roles', 'Auditoría']) expect(out).not.toContain(`>${label}<`);
    expect(out).toContain('Puntos de venta');
  });

  it('renders the API error instead of the shell when /me fails', async () => {
    getMe.mockResolvedValue({ ok: false, status: 503, message: 'El servicio no está disponible.' });
    const out = await render();
    expect(out).toContain('El servicio no está disponible.');
    expect(out).not.toContain('Navegación principal');
  });
});

describe('form fields', () => {
  it('location fields carry the id only when editing', () => {
    expect(renderToStaticMarkup(<LocationFields />)).not.toContain('name="id"');
    expect(renderToStaticMarkup(<LocationFields id="x" name="Centro" code="C1" />)).toContain('name="id"');
  });

  it('user fields explain the one-time temporary password', () => {
    expect(renderToStaticMarkup(<UserFields />)).toContain('una sola vez');
  });

  it('role fields render the permission matrix', () => {
    expect(renderToStaticMarkup(<RoleFields name="X" permissions={['sales:create']} />)).toContain('Registrar ventas');
  });
});

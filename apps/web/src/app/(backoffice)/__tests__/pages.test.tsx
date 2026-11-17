import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionGrant } from '@monaco/contracts';

const getMe = vi.fn();
const callApi = vi.fn();
vi.mock('@/lib/api/me', () => ({ getMe: () => getMe() }));
vi.mock('@/lib/api/admin', () => ({ callApi: (...args: unknown[]) => callApi(...args), requestInit: () => ({}) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('../puntos-de-venta/actions', () => ({ createLocationAction: vi.fn(), updateLocationAction: vi.fn(), archiveLocationAction: vi.fn() }));
vi.mock('../roles/actions', () => ({ createRoleAction: vi.fn(), updateRoleAction: vi.fn(), deleteRoleAction: vi.fn() }));
vi.mock('../usuarios/actions', () => ({ createUserAction: vi.fn(), resetPasswordAction: vi.fn(), disableUserAction: vi.fn() }));
vi.mock('../usuarios/[id]/actions', () => ({ replaceAssignmentsAction: vi.fn() }));
vi.mock('../dispositivos/actions', () => ({ revokeDeviceAction: vi.fn() }));

import AuditPage from '../auditoria/page';
import DevicesPage from '../dispositivos/page';
import LocationsPage from '../puntos-de-venta/page';
import RolesPage from '../roles/page';
import UserAssignmentsPage from '../usuarios/[id]/page';
import UsersPage from '../usuarios/page';

const ID = '018f0000-0000-7000-8000-000000000001';
const tenant = { type: 'tenant' } as const;
const grants = (...permissions: string[]): PermissionGrant[] => permissions.map((permission) => ({ permission, scope: tenant }) as PermissionGrant);
const asUser = (...permissions: string[]) => getMe.mockResolvedValue({ ok: true, data: { permissions: grants(...permissions) } });
const page = <T,>(items: T[], nextCursor: string | null = null) => ({ ok: true, data: { items, nextCursor } });
const search = (q: Record<string, string> = {}) => Promise.resolve(q);
const html = async (element: Promise<React.ReactElement | null>) => renderToStaticMarkup((await element) ?? <></>);

const location = { id: ID, name: 'Centro', code: 'CEN', archivedAt: null, createdAt: '2026-11-01T00:00:00.000Z' };
const role = { id: ID, key: null, name: 'Supervisor', isSystem: false, permissions: ['sales:create'], createdAt: '2026-11-01T00:00:00.000Z' };
const owner = { ...role, id: '018f0000-0000-7000-8000-000000000002', key: 'owner', name: 'Propietario', isSystem: true };
const user = { id: ID, email: 'ana@example.com', displayName: 'Ana', status: 'active', mustChangePassword: true, createdAt: '2026-11-01T00:00:00.000Z' };
const device = { id: ID, userId: ID, label: 'Chrome', platform: 'web', createdAt: '2026-11-01T00:00:00.000Z', lastSeenAt: null, revokedAt: null, current: true };

beforeEach(() => {
  getMe.mockReset();
  callApi.mockReset();
});

describe('locations page', () => {
  it('owner sees create, edit and archive actions', async () => {
    asUser('locations:manage');
    callApi.mockResolvedValue(page([location]));
    const out = await html(LocationsPage({ searchParams: search() }));
    for (const label of ['Nuevo punto de venta', 'Editar', 'Archivar', 'Centro']) expect(out).toContain(label);
  });

  it('cashier sees the list but no administrative actions', async () => {
    asUser('sales:create');
    callApi.mockResolvedValue(page([location]));
    const out = await html(LocationsPage({ searchParams: search() }));
    expect(out).toContain('Centro');
    for (const label of ['Nuevo punto de venta', 'Editar', 'Archivar', 'Acciones']) expect(out).not.toContain(label);
  });

  it('renders an API failure as a Spanish alert', async () => {
    asUser('locations:manage');
    callApi.mockResolvedValue({ ok: false, status: 503, message: 'El servicio no está disponible.' });
    expect(await html(LocationsPage({ searchParams: search() }))).toContain('El servicio no está disponible.');
  });
});

describe('roles page', () => {
  it('denies the section to users without roles:manage', async () => {
    asUser('sales:create');
    expect(await html(RolesPage({ searchParams: search() }))).toContain('No tienes acceso');
    expect(callApi).not.toHaveBeenCalled();
  });

  it('lists custom roles as editable/deletable and the Owner role read-only', async () => {
    asUser('roles:manage');
    callApi.mockResolvedValue(page([role, owner]));
    const out = await html(RolesPage({ searchParams: search() }));
    expect(out).toContain('Eliminar');
    expect(out).toContain('Editar');
    expect(out).toContain('>Ver<');
    expect(out.match(/Eliminar/g)).toHaveLength(1);
  });
});

describe('users page', () => {
  it('denies the section to users without users:manage', async () => {
    asUser('roles:manage');
    expect(await html(UsersPage({ searchParams: search() }))).toContain('No tienes acceso');
  });

  it('shows user actions; the assignments link needs roles:manage too', async () => {
    asUser('users:manage');
    callApi.mockResolvedValue(page([user]));
    const onlyUsers = await html(UsersPage({ searchParams: search() }));
    expect(onlyUsers).toContain('Desactivar');
    expect(onlyUsers).toContain('Restablecer contraseña');
    expect(onlyUsers).not.toContain('Asignaciones');
    asUser('users:manage', 'roles:manage');
    expect(await html(UsersPage({ searchParams: search() }))).toContain(`href="/usuarios/${ID}"`);
  });
});

describe('user assignments page', () => {
  it('rejects a malformed id and a missing permission', async () => {
    asUser('users:manage', 'roles:manage');
    expect(await html(UserAssignmentsPage({ params: Promise.resolve({ id: 'nope' }) }))).toContain('no existe');
    asUser('users:manage');
    expect(await html(UserAssignmentsPage({ params: Promise.resolve({ id: ID }) }))).toContain('No tienes acceso');
  });

  it('loads user, roles and active locations into the editor', async () => {
    asUser('users:manage', 'roles:manage');
    callApi
      .mockResolvedValueOnce({ ok: true, data: { ...user, assignments: [{ id: 'a', roleId: ID, scope: { type: 'tenant' } }] } })
      .mockResolvedValueOnce(page([role]))
      .mockResolvedValueOnce(page([location, { ...location, id: 'x', name: 'Viejo', archivedAt: '2026-11-02T00:00:00.000Z' }]));
    const out = await html(UserAssignmentsPage({ params: Promise.resolve({ id: ID }) }));
    expect(out).toContain('Guardar asignaciones');
    expect(out).toContain('Ana');
    expect(out).not.toContain('Viejo');
  });

  it('shows the first API failure', async () => {
    asUser('users:manage', 'roles:manage');
    callApi.mockResolvedValueOnce({ ok: false, status: 404, message: 'El registro no existe o ya no está disponible.' }).mockResolvedValue(page([]));
    expect(await html(UserAssignmentsPage({ params: Promise.resolve({ id: ID }) }))).toContain('no existe');
  });
});

describe('devices page', () => {
  it('a regular user only sees their own devices, without the other-user filter', async () => {
    asUser('sales:create');
    callApi.mockResolvedValue(page([device]));
    const out = await html(DevicesPage({ searchParams: search({ userId: ID }) }));
    expect(out).toContain('Este dispositivo');
    expect(out).toContain('Revocar');
    expect(out).not.toContain('Ver dispositivos de otro usuario');
    expect(JSON.stringify(callApi.mock.calls)).not.toContain(ID);
  });

  it('devices:manage without users:manage gets a free id field; with it, a user selector', async () => {
    asUser('devices:manage');
    callApi.mockResolvedValue(page([]));
    expect(await html(DevicesPage({ searchParams: search() }))).toContain('placeholder="ID del usuario"');
    asUser('devices:manage', 'users:manage');
    callApi.mockResolvedValue(page([user]));
    expect(await html(DevicesPage({ searchParams: search() }))).toContain('Ana (ana@example.com)');
  });

  it('marks revoked devices and offers no revoke button', async () => {
    asUser('sales:create');
    callApi.mockResolvedValue(page([{ ...device, current: false, revokedAt: '2026-11-02T00:00:00.000Z' }]));
    const out = await html(DevicesPage({ searchParams: search() }));
    expect(out).toContain('Revocado');
    expect(out).not.toContain('>Revocar<');
  });
});

describe('audit page', () => {
  it('denies the section without audit:view', async () => {
    asUser('users:manage');
    expect(await html(AuditPage({ searchParams: search() }))).toContain('No tienes acceso');
  });

  it('renders events with Spanish labels and a next-page link', async () => {
    asUser('audit:view');
    callApi.mockResolvedValue(page([{ id: ID, actorUserId: ID, type: 'role_created', targetType: 'role', targetId: ID, metadata: {}, ip: '203.0.113.9', createdAt: '2026-11-05T15:30:00.000Z' }], 'next-1'));
    const out = await html(AuditPage({ searchParams: search() }));
    expect(out).toContain('Rol creado');
    expect(out).toContain('203.0.113.9');
    expect(out).toContain('cursor=next-1');
  });
});

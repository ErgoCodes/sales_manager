import { fireEvent, screen } from '@testing-library/dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({ replaceAssignmentsAction: async () => ({ done: true }) }));

import { act, renderWithReact } from '../../../../../../vitest.render';
import { AssignmentsEditor } from '../assignments-editor';

const U = '018f0000-0000-7000-8000-000000000001';
const R_CASHIER = '018f0000-0000-7000-8000-0000000000a1';
const R_MANAGER = '018f0000-0000-7000-8000-0000000000a2';
const L1 = '018f0000-0000-7000-8000-0000000000b1';
const L2 = '018f0000-0000-7000-8000-0000000000b2';
const roles = [
  { id: R_CASHIER, name: 'Cajero', permissions: ['sales:create'] },
  { id: R_MANAGER, name: 'Gerente', permissions: ['users:manage'] },
] as never;
const locations = [
  { id: L1, name: 'Centro' },
  { id: L2, name: 'Norte' },
];

describe('AssignmentsEditor (static markup)', () => {
  it('shows the current assignments with role and location names', () => {
    const html = renderToStaticMarkup(
      <AssignmentsEditor userId={U} roles={roles} locations={locations} initial={[{ id: 'a', roleId: R_CASHIER, scope: { type: 'locations', locationIds: [L1] } }]} />,
    );
    expect(html).toContain('Cajero');
    expect(html).toContain('Centro');
    expect(html).toContain('Norte');
    expect(html).toContain(`name="payload"`);
    expect(html).toContain(`name="id" value="${U}"`);
  });

  it('puts a built payload in the hidden field and blocks save when a row is invalid', () => {
    const valid = renderToStaticMarkup(<AssignmentsEditor userId={U} roles={roles} locations={locations} initial={[{ id: 'a', roleId: R_CASHIER, scope: { type: 'tenant' } }]} />);
    expect(valid).toContain(JSON.stringify([{ roleId: R_CASHIER, scope: { type: 'tenant' } }]).replaceAll('"', '&quot;'));
    const invalid = renderToStaticMarkup(
      <AssignmentsEditor userId={U} roles={roles} locations={locations} initial={[{ id: 'a', roleId: R_MANAGER, scope: { type: 'locations', locationIds: [L1] } }]} />,
    );
    expect(invalid).toMatch(/role="alert"[^>]*>[^<]*todo el negocio/);
    expect(invalid).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
  });
});

describe('AssignmentsEditor (interaction)', () => {
  it('adds and removes assignment rows', () => {
    const { unmount } = renderWithReact(<AssignmentsEditor userId={U} roles={roles} locations={locations} initial={[]} />);
    const rows = () => screen.queryAllByRole('group', { name: /Asignación/ });
    expect(rows()).toHaveLength(0);
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Agregar asignación' })));
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Elige un rol');
    expect(screen.getByRole('button', { name: 'Guardar asignaciones' })).toBeDisabled();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Quitar' })));
    expect(rows()).toHaveLength(0);
    unmount();
  });

  it('updates the submitted payload when a location is checked', () => {
    const { container, unmount } = renderWithReact(
      <AssignmentsEditor userId={U} roles={roles} locations={locations} initial={[{ id: 'a', roleId: R_CASHIER, scope: { type: 'locations', locationIds: [L1] } }]} />,
    );
    const payload = () => JSON.parse((container.querySelector('input[name="payload"]') as HTMLInputElement).value);
    expect(payload()).toEqual([{ roleId: R_CASHIER, scope: { type: 'locations', locationIds: [L1] } }]);
    act(() => void fireEvent.click(screen.getByRole('checkbox', { name: 'Norte' })));
    expect(payload()).toEqual([{ roleId: R_CASHIER, scope: { type: 'locations', locationIds: [L1, L2] } }]);
    act(() => void fireEvent.click(screen.getByRole('checkbox', { name: 'Centro' })));
    act(() => void fireEvent.click(screen.getByRole('checkbox', { name: 'Norte' })));
    expect(screen.getByRole('alert')).toHaveTextContent('al menos un punto de venta');
    expect(screen.getByRole('button', { name: 'Guardar asignaciones' })).toBeDisabled();
    unmount();
  });
});

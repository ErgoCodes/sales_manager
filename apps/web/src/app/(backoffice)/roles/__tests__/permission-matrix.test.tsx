import { fireEvent, screen } from '@testing-library/dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@monaco/contracts';
import { act, renderWithReact } from '../../../../../vitest.render';
import { PermissionMatrix } from '../permission-matrix';

describe('PermissionMatrix', () => {
  it('groups the catalog under Spanish headings and lists every permission once', () => {
    const html = renderToStaticMarkup(<PermissionMatrix initial={[]} idPrefix="t" />);
    for (const heading of ['Administración', 'Catálogo e inventario', 'Ventas y caja', 'Reportes']) expect(html).toContain(heading);
    for (const p of PERMISSIONS) expect(html.match(new RegExp(`id="perm-t-${p}"`, 'g'))).toHaveLength(1);
  });

  it('submits the initial selection as hidden `permissions` fields', () => {
    const html = renderToStaticMarkup(<PermissionMatrix initial={['sales:create', 'reports:view']} idPrefix="t" />);
    expect(html.match(/<input[^>]*type="hidden"[^>]*name="permissions"[^>]*>/g)).toHaveLength(2);
    expect(html).toContain('value="sales:create"');
  });

  it('read-only mode disables the checkboxes and submits nothing', () => {
    const html = renderToStaticMarkup(<PermissionMatrix initial={['sales:create']} readOnly idPrefix="t" />);
    expect(html).not.toContain('name="permissions"');
    expect(html.match(/<button[^>]*disabled=""/g)?.length).toBe(PERMISSIONS.length);
  });

  it('checking and unchecking updates the submitted permissions', () => {
    const { container, unmount } = renderWithReact(<PermissionMatrix initial={['sales:create']} idPrefix="t" />);
    const submitted = () => [...container.querySelectorAll<HTMLInputElement>('input[name="permissions"]')].map((i) => i.value);
    expect(submitted()).toEqual(['sales:create']);
    act(() => void fireEvent.click(screen.getByRole('checkbox', { name: 'Ver reportes' })));
    expect(submitted()).toEqual(['sales:create', 'reports:view']);
    act(() => void fireEvent.click(screen.getByRole('checkbox', { name: 'Registrar ventas' })));
    expect(submitted()).toEqual(['reports:view']);
    unmount();
  });
});

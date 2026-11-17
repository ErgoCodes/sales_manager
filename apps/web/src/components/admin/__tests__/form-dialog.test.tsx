import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ActionState } from '@/lib/action-state';
import { act, renderWithReact } from '../../../../vitest.render';
import { FormDialog } from '../form-dialog';
import { ErrorNotice, NoAccess } from '../page-state';
import { Pager } from '../pager';
import { TemporaryPasswordNotice } from '../temporary-password-notice';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

async function openAndSubmit(action: (prev: ActionState, formData: FormData) => Promise<ActionState>, props: Partial<Parameters<typeof FormDialog>[0]> = {}) {
  const view = renderWithReact(
    <FormDialog trigger="Abrir" title="Mi diálogo" submitLabel="Enviar" action={action} {...props}>
      <input name="x" defaultValue="1" aria-label="x" />
    </FormDialog>,
  );
  act(() => void fireEvent.click(screen.getByRole('button', { name: 'Abrir' })));
  await screen.findByRole('dialog');
  return view;
}

describe('FormDialog', () => {
  it('stays closed until the trigger is pressed', () => {
    const html = renderToStaticMarkup(
      <FormDialog trigger="Abrir" title="T" submitLabel="Ok" action={async () => ({})}>
        <span>campo</span>
      </FormDialog>,
    );
    expect(html).toContain('Abrir');
    expect(html).not.toContain('campo');
  });

  it('submits the form to the action and closes on success', async () => {
    const action = vi.fn(async () => ({ done: true }));
    const { unmount } = await openAndSubmit(action);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Enviar' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((action.mock.calls[0] as unknown[])[1]).toBeInstanceOf(FormData);
    unmount();
  });

  it('renders the action error inside the dialog and keeps it open', async () => {
    const { unmount } = await openAndSubmit(async () => ({ error: 'No tienes permiso para realizar esta acción.' }));
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Enviar' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    unmount();
  });

  it('shows a temporary password once and discards it when the dialog closes', async () => {
    const { unmount } = await openAndSubmit(async () => ({ done: true, temporaryPassword: { value: 'tmp-Secret-123456', expiresAt: '2026-11-20T10:00:00.000Z', email: 'ana@example.com' } }));
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Enviar' })));
    expect(await screen.findByTestId('temporary-password')).toHaveTextContent('tmp-Secret-123456');
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Cerrar' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.textContent).not.toContain('tmp-Secret-123456');
    unmount();
  });

  it('read-only dialogs have no submit button', async () => {
    const { unmount } = await openAndSubmit(async () => ({}), { readOnly: true });
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
    unmount();
  });
});

describe('TemporaryPasswordNotice', () => {
  it('says it is shown once and when it expires', () => {
    const html = renderToStaticMarkup(<TemporaryPasswordNotice email="ana@example.com" password="p" expiresAt="2026-11-20T10:00:00.000Z" />);
    expect(html).toContain('una sola vez');
    expect(html).toContain('ana@example.com');
    expect(html).toMatch(/Vence el .*2026/);
  });
});

describe('Pager and page notices', () => {
  it('links to the next page with the cursor and keeps extra query params', () => {
    const html = renderToStaticMarkup(<Pager basePath="/x" nextCursor="abc" extraQuery={{ userId: 'u1' }} />);
    expect(html).toContain('href="/x?userId=u1&amp;cursor=abc"');
    expect(html).toContain('href="/x?userId=u1"');
  });

  it('omits "Siguiente" on the last page', () => {
    expect(renderToStaticMarkup(<Pager basePath="/x" nextCursor={null} />)).not.toContain('Siguiente');
  });

  it('renders alerts', () => {
    expect(renderToStaticMarkup(<ErrorNotice message="boom" />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<NoAccess />)).toContain('No tienes acceso');
  });
});

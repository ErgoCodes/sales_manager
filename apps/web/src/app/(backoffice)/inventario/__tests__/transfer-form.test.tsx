import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { describe, expect, it, vi } from 'vitest';

import { act, renderWithReact } from '../../../../../vitest.render';
import type { InventoryActionState, ProductOption } from '@/lib/inventory/document-form';
import { InventoryDocumentForm } from '../document-form';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const ID = '018f0000-0000-7000-8000-0000000000d1';
const ORIGIN = '018f0000-0000-7000-8000-0000000000b1';
const NORTE = '018f0000-0000-7000-8000-0000000000b2';
const SUR = '018f0000-0000-7000-8000-0000000000b3';
const P1 = '018f0000-0000-7000-8000-000000000001';
const P2 = '018f0000-0000-7000-8000-000000000002';
const products: ProductOption[] = [
  { id: P1, name: 'Arroz', unitOfMeasure: 'kg', currency: null, quantity: 10, archived: false },
  { id: P2, name: 'Viejo', unitOfMeasure: 'ud', currency: null, quantity: 4, archived: true },
];
const destinations = [
  { id: ORIGIN, name: 'Centro' },
  { id: NORTE, name: 'Norte' },
  { id: SUR, name: 'Sur' },
];
type Action = (prev: InventoryActionState, formData: FormData) => Promise<InventoryActionState>;

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;
const change = (label: string, value: string) => act(() => void fireEvent.change(field(label), { target: { value } }));
const submit = () => act(async () => void fireEvent.submit(document.querySelector('form')!));
const render = (action: Action = vi.fn(async () => ({}))) =>
  renderWithReact(
    <InventoryDocumentForm kind="transfer" documentId={ID} locationId={ORIGIN} destinations={destinations} products={products} today="2026-11-21" action={action} cancelHref="/inventario" />,
  );

describe('InventoryDocumentForm (transfer)', () => {
  it('offers every destination but the origin, and no cost nor reason', () => {
    const { unmount } = render();
    const options = [...(field('Destino') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['Elige el destino', 'Norte', 'Sur']);
    expect(document.querySelector('input[type="hidden"][name="locationId"]')).toHaveValue(ORIGIN);
    expect(screen.queryByLabelText('Costo unitario (línea 1)')).toBeNull();
    expect(screen.queryByLabelText('Motivo')).toBeNull();
    const productOptions = [...(field('Producto (línea 1)') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(productOptions.join()).not.toContain('Viejo');
    unmount();
  });

  it('does not submit without a destination and explains why', async () => {
    const action = vi.fn<Action>(async () => ({}));
    const { unmount } = render(action);
    change('Producto (línea 1)', P1);
    change('Cantidad (línea 1)', '2');
    await submit();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText('Elige el punto de destino.')).toBeInTheDocument();
    expect(field('Destino')).toHaveAttribute('aria-invalid', 'true');
    unmount();
  });

  it('validates the lines as the user types', () => {
    const { unmount } = render();
    change('Cantidad (línea 1)', '-1');
    expect(screen.getByText(/mayor que 0/)).toBeInTheDocument();
    unmount();
  });

  it('a double submit and a resubmit after an error send the same document id, with origin and destination', async () => {
    const action = vi.fn<Action>(async () => ({ error: 'No hay stock suficiente para registrar el documento.', shortages: [{ productId: P1, available: 1, shortBy: 1 }] }));
    const { unmount } = render(action);
    change('Destino', SUR);
    change('Producto (línea 1)', P1);
    change('Cantidad (línea 1)', '2');
    await act(async () => {
      const form = document.querySelector('form')!;
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Arroz: disponible 1 kg, faltan 1 kg/);
    change('Cantidad (línea 1)', '1');
    await submit();
    await waitFor(() => expect(action).toHaveBeenCalledTimes(3));
    const posted = action.mock.calls.map(([, data]) => [data.get('id'), data.get('locationId'), data.get('toLocationId')]);
    expect(posted).toEqual([
      [ID, ORIGIN, SUR],
      [ID, ORIGIN, SUR],
      [ID, ORIGIN, SUR],
    ]);
    unmount();
  });
});

import { fireEvent, screen } from '@testing-library/dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { act, renderWithReact } from '../../../../../vitest.render';
import { ProductFormFields } from '../product-form-fields';

const ID = '018f0000-0000-7000-8000-000000000001';
const product = {
  id: ID,
  name: 'Arroz',
  unitOfMeasure: 'kg',
  category: 'Granos',
  currency: 'CUP' as const,
  costPrice: { amount: 8000, currency: 'CUP' as const },
  cashPrice: { amount: 10000, currency: 'CUP' as const },
  transferPrice: { amount: 12000, currency: 'CUP' as const },
  lowStockThreshold: null,
  expirationDate: null,
};

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => act(() => void fireEvent.change(input(label), { target: { value } }));

describe('ProductFormFields', () => {
  it('renders every product field with the names the Server Action reads', () => {
    const html = renderToStaticMarkup(<ProductFormFields showCost />);
    for (const name of ['name', 'unitOfMeasure', 'category', 'currency', 'costPrice', 'cashPrice', 'transferPrice', 'lowStockThreshold', 'expirationDate']) expect(html).toContain(`name="${name}"`);
    expect(html).not.toContain('name="id"');
  });

  it('hides the cost field entirely when the cost is not visible', () => {
    const html = renderToStaticMarkup(<ProductFormFields showCost={false} product={{ ...product, costPrice: null }} />);
    expect(html).not.toContain('name="costPrice"');
    expect(html).not.toContain('Costo');
    expect(html).toContain(`name="id" value="${ID}"`);
  });

  it('proposes the transfer price from the cash price while it was not edited by hand', () => {
    const { unmount } = renderWithReact(<ProductFormFields showCost />);
    type('Precio en efectivo', '100');
    expect(input('Precio por transferencia').value).toBe('110.00');
    expect(screen.getByText(/Propuesta: 110\.00/)).toBeInTheDocument();
    type('Precio por transferencia', '125');
    type('Precio en efectivo', '200');
    expect(input('Precio por transferencia').value).toBe('125');
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Usar propuesta' })));
    expect(input('Precio por transferencia').value).toBe('220.00');
    unmount();
  });

  it('keeps an existing transfer price when editing, until the proposal is applied', () => {
    const { unmount } = renderWithReact(<ProductFormFields showCost product={product} />);
    expect(input('Precio por transferencia').value).toBe('120.00');
    type('Precio en efectivo', '150');
    expect(input('Precio por transferencia').value).toBe('120.00');
    unmount();
  });

  it('shows a Spanish validation error on an invalid amount and marks the field invalid', () => {
    const { unmount } = renderWithReact(<ProductFormFields showCost />);
    type('Precio en efectivo', '12.345');
    expect(input('Precio en efectivo')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/importe no es válido/)).toBeInTheDocument();
    type('Nombre', '  ');
    expect(screen.getByText(/nombre es obligatorio/)).toBeInTheDocument();
    unmount();
  });
});

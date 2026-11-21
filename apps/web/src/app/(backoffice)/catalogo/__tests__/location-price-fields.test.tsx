import { fireEvent, screen } from '@testing-library/dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { act, renderWithReact } from '../../../../../vitest.render';
import { LocationPriceFields } from '../location-price-fields';

const P = '018f0000-0000-7000-8000-000000000001';
const L = '018f0000-0000-7000-8000-0000000000b1';
const props = {
  productId: P,
  locationId: L,
  currency: 'CUP' as const,
  basePrices: { cash: { amount: 10000, currency: 'CUP' as const }, transfer: { amount: 11000, currency: 'CUP' as const } },
  overrides: { cash: null, transfer: null },
};

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => act(() => void fireEvent.change(input(label), { target: { value } }));

describe('LocationPriceFields', () => {
  it('posts the product, location and currency, and shows the base prices as reference', () => {
    const html = renderToStaticMarkup(<LocationPriceFields {...props} />);
    expect(html).toContain(`name="productId" value="${P}"`);
    expect(html).toContain(`name="locationId" value="${L}"`);
    expect(html).toContain('name="currency" value="CUP"');
    expect(html).toContain('$100.00 CUP');
    expect(html).toContain('$110.00 CUP');
    expect(html).toMatch(/vacío.*precio base/);
  });

  it('prefills the current overrides', () => {
    const { unmount } = renderWithReact(<LocationPriceFields {...props} overrides={{ cash: { amount: 2000, currency: 'CUP' }, transfer: null }} />);
    expect(input('Precio en efectivo del punto').value).toBe('20.00');
    expect(input('Precio por transferencia del punto').value).toBe('');
    unmount();
  });

  it('proposes the transfer override from the cash override with the domain rule', () => {
    const { unmount } = renderWithReact(<LocationPriceFields {...props} />);
    type('Precio en efectivo del punto', '200');
    expect(input('Precio por transferencia del punto').value).toBe('220.00');
    type('Precio por transferencia del punto', '230');
    type('Precio en efectivo del punto', '300');
    expect(input('Precio por transferencia del punto').value).toBe('230');
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Usar propuesta' })));
    expect(input('Precio por transferencia del punto').value).toBe('330.00');
    unmount();
  });

  it('shows a Spanish error on an invalid amount', () => {
    const { unmount } = renderWithReact(<LocationPriceFields {...props} />);
    type('Precio por transferencia del punto', 'abc');
    expect(input('Precio por transferencia del punto')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/importe no es válido/)).toBeInTheDocument();
    unmount();
  });
});

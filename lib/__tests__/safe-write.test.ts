import { Alert } from 'react-native';

import { safeWrite } from '../safe-write';

describe('safeWrite', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns ok:true with the action result when it succeeds', async () => {
    const result = await safeWrite(() => 42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('awaits an async action', async () => {
    const result = await safeWrite(async () => 'done');
    expect(result).toEqual({ ok: true, value: 'done' });
  });

  it('returns ok:false and shows an alert when the action throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const result = await safeWrite(() => {
      throw new Error('boom');
    }, 'No se pudo guardar el producto');

    expect(result).toEqual({ ok: false });
    expect(alertSpy).toHaveBeenCalledWith(
      'No se pudo guardar el producto',
      expect.any(String),
    );
  });
});

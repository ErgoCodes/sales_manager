import { beforeEach, describe, expect, it, vi } from 'vitest';

const setSpy = vi.fn();
const post = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set: setSpy, get: () => undefined }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/api/authenticated', () => ({ createAuthenticatedClient: async () => ({ POST: post }) }));

import { changePasswordAction } from '../actions';

const form = (cur: string, next: string, confirm = next) => {
  const f = new FormData();
  f.set('currentPassword', cur);
  f.set('newPassword', next);
  f.set('confirmPassword', confirm);
  return f;
};
const NEW = 'a brand new passphrase';

beforeEach(() => {
  setSpy.mockReset();
  post.mockReset();
});

describe('changePasswordAction', () => {
  it.each([
    [form('', NEW), /Completa/],
    [form('old-password-123', NEW, 'different passphrase'), /confirmación/],
    [form('old-password-123', 'short'), /al menos 12/],
    [form('same-password-123', 'same-password-123'), /distinta/],
  ])('validates locally without calling the API', async (data, message) => {
    expect((await changePasswordAction({}, data)).error).toMatch(message);
    expect(post).not.toHaveBeenCalled();
  });

  it('stores the rotated session, clears the must-change flag and redirects', async () => {
    post.mockResolvedValue({
      data: { accessToken: 'a', refreshToken: 'r', expiresIn: 600, deviceId: 'd', mustChangePassword: false },
      response: { status: 200 },
    });
    await expect(changePasswordAction({}, form('old-password-123', NEW))).rejects.toThrow('REDIRECT:/');
    expect(post.mock.calls[0]![1].body).toEqual({ currentPassword: 'old-password-123', newPassword: NEW });
    const names = setSpy.mock.calls.map((c) => c[0]);
    expect(names).toEqual(expect.arrayContaining(['__Host-access', '__Host-refresh', '__Host-must_change_password']));
  });

  it.each([
    [400, /No se pudo cambiar/],
    [429, /Demasiados intentos/],
    [503, /no está disponible/],
  ])('maps API status %i to a Spanish message', async (status, message) => {
    post.mockResolvedValue({ data: undefined, response: { status } });
    expect((await changePasswordAction({}, form('old-password-123', NEW))).error).toMatch(message);
  });

  it('explains a read-only demo tenant (403 DEMO_READ_ONLY)', async () => {
    post.mockResolvedValue({ data: undefined, error: { error: { code: 'DEMO_READ_ONLY', message: 'x' } }, response: { status: 403 } });
    expect((await changePasswordAction({}, form('old-password-123', NEW))).error).toMatch(/^Demo de solo lectura/);
  });

  it('sends an expired session (401 after the refresh retry) to /login', async () => {
    post.mockResolvedValue({ data: undefined, response: { status: 401 } });
    await expect(changePasswordAction({}, form('old-password-123', NEW))).rejects.toThrow('REDIRECT:/login');
  });

  it('maps a network failure', async () => {
    post.mockRejectedValue(new Error('down'));
    expect((await changePasswordAction({}, form('old-password-123', NEW))).error).toMatch(/conectar/);
  });
});

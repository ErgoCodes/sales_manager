import { describe, expect, it } from 'vitest';
import { describeApiError } from '../api-errors';

describe('describeApiError', () => {
  it.each([
    [403, undefined, 'No tienes permiso'],
    [404, undefined, 'no existe'],
    [409, undefined, 'conflicto'],
    [422, undefined, 'datos'],
    [429, undefined, 'Demasiados'],
    [500, undefined, 'no está disponible'],
    [503, undefined, 'no está disponible'],
  ])('maps status %s to a Spanish message', (status, code, text) => {
    expect(describeApiError(status, code)).toContain(text);
  });

  it('prefers a specific message for known API codes', () => {
    expect(describeApiError(409, 'owner_invariant_violation')).toContain('propietario');
    expect(describeApiError(409, 'role_in_use')).toContain('en uso');
    expect(describeApiError(403, 'forbidden_escalation')).toContain('permisos que tú no tienes');
    expect(describeApiError(409, 'system_role_immutable')).toContain('sistema');
    expect(describeApiError(422, 'invalid_scope')).toContain('alcance');
  });

  it('falls back to the status message for unknown codes and never echoes API text', () => {
    expect(describeApiError(409, 'something_new')).toBe(describeApiError(409));
    expect(describeApiError(0)).toContain('No se pudo');
  });
});

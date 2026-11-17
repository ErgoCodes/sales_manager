/**
 * Spanish messages for API failures. Only the status and the stable error `code` are used:
 * the API's own message text is never echoed to the user.
 */
const BY_CODE: Record<string, string> = {
  owner_invariant_violation: 'La acción dejaría al negocio sin ningún propietario activo.',
  role_in_use: 'El rol está en uso: quita sus asignaciones antes de eliminarlo.',
  system_role_immutable: 'Los roles de sistema no se pueden editar ni eliminar.',
  forbidden_escalation: 'No puedes otorgar permisos que tú no tienes, ni administrar a un propietario sin serlo.',
  self_modification: 'No puedes modificar tus propias asignaciones.',
  invalid_scope: 'El alcance no es válido: los permisos administrativos solo valen para todo el negocio.',
  permission_denied: 'No tienes permiso para realizar esta acción.',
  conflict: 'Ya existe un registro con esos datos (conflicto).',
};

const BY_STATUS: Record<number, string> = {
  401: 'Tu sesión terminó. Inicia sesión de nuevo.',
  403: 'No tienes permiso para realizar esta acción.',
  404: 'El registro no existe o ya no está disponible.',
  409: 'La acción provoca un conflicto con el estado actual. Actualiza la página e inténtalo de nuevo.',
  422: 'Los datos no son válidos. Revísalos e inténtalo de nuevo.',
  429: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.',
};

export function describeApiError(status: number, code?: string): string {
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (BY_STATUS[status]) return BY_STATUS[status];
  if (status >= 500) return 'El servicio no está disponible. Inténtalo de nuevo en unos minutos.';
  return 'No se pudo completar la acción. Inténtalo de nuevo.';
}

/** Extracts the stable error code from an API error body, when present. */
export function errorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

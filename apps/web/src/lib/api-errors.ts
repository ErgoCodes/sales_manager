/**
 * Spanish messages for API failures. Only the status and the stable error `code` are used:
 * the API's own message text is never echoed to the user.
 */
const BY_CODE: Record<string, string> = {
  // SP4 · D10: every mutation of the public demo tenant but login, refresh and logout.
  DEMO_READ_ONLY: 'Demo de solo lectura: puedes recorrer todo, pero los cambios no se guardan.',
  owner_invariant_violation: 'La acción dejaría al negocio sin ningún propietario activo.',
  role_in_use: 'El rol está en uso: quita sus asignaciones antes de eliminarlo.',
  system_role_immutable: 'Los roles de sistema no se pueden editar ni eliminar.',
  forbidden_escalation: 'No puedes otorgar permisos que tú no tienes, ni administrar a un propietario sin serlo.',
  self_modification: 'No puedes modificar tus propias asignaciones.',
  invalid_scope: 'El alcance no es válido: los permisos administrativos solo valen para todo el negocio.',
  permission_denied: 'No tienes permiso para realizar esta acción.',
  conflict: 'Ya existe un registro con esos datos (conflicto).',
  ARCHIVED: 'El registro está archivado y no admite esta operación.',
  INSUFFICIENT_STOCK: 'No hay stock suficiente para registrar el documento.',
  ALREADY_REVERSED: 'El documento ya fue revertido o es una reversión: un documento solo se revierte una vez.',
  IDEMPOTENCY_CONFLICT: 'Este formulario ya se usó para registrar otro documento. Recarga la página e inténtalo de nuevo.',
  CURRENCY_MISMATCH:
    'No se pudo aplicar la moneda: los importes deben estar en la moneda del producto. Para cambiar la moneda hay que volver a ingresar todos los precios base, quitar antes los precios por punto, y no es posible si el producto ya tiene movimientos de inventario.',
};

const BY_STATUS: Record<number, string> = {
  400: 'Los datos no son válidos. Revísalos e inténtalo de nuevo.',
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

export interface ErrorDetail {
  path: string;
  message: string;
}

/** Extracts `error.details` from an API error body (validation issues, `INSUFFICIENT_STOCK` shortages). */
export function errorDetails(body: unknown): ErrorDetail[] {
  if (typeof body !== 'object' || body === null) return [];
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return [];
  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return [];
  return details.filter((d): d is ErrorDetail => typeof d === 'object' && d !== null && typeof d.path === 'string' && typeof d.message === 'string').map(({ path, message }) => ({ path, message }));
}

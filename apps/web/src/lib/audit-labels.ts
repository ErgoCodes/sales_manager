import type { AuditEventType } from '@monaco/contracts';

export const AUDIT_EVENT_LABELS: Record<AuditEventType, string> = {
  login_succeeded: 'Inicio de sesión',
  login_failed: 'Inicio de sesión fallido',
  refresh_reuse_detected: 'Reutilización de sesión detectada',
  password_changed: 'Cambio de contraseña',
  user_created: 'Usuario creado',
  user_create_conflict: 'Alta de usuario rechazada (correo ya registrado)',
  user_updated: 'Usuario modificado',
  user_disabled: 'Usuario desactivado',
  user_password_reset: 'Contraseña restablecida',
  device_revoked: 'Dispositivo revocado',
  session_revoked: 'Sesión cerrada',
  role_created: 'Rol creado',
  role_updated: 'Rol modificado',
  role_deleted: 'Rol eliminado',
  assignments_replaced: 'Asignaciones reemplazadas',
  location_created: 'Punto de venta creado',
  location_updated: 'Punto de venta modificado',
  location_archived: 'Punto de venta archivado',
  escalation_denied: 'Escalada de privilegios denegada',
};

const formatter = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/** Dates are shown in UTC so server and client always agree; the column header says so. */
export function formatDateTime(iso: string | null): string {
  return iso ? formatter.format(new Date(iso)) : '—';
}

export function shortId(id: string | null): string {
  return id ? `${id.slice(0, 8)}…` : '—';
}

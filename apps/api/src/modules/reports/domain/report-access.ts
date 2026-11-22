import type { ReportScope } from '@monaco/contracts';

import { PermissionDenied } from '../../iam/domain/errors';
import { can, hasPermissionAnywhere } from '../../iam/domain/permissions';
import type { EffectivePermissions } from '../../iam/domain/types';

/*
 * Who may see which report (SP4 spec, "Alcance por punto, RLS y permisos"; ADR 0005).
 * Permission + location, never the role name. `reports:view` is financial: it sees
 * profit, margin, valued losses and inventory value (D5). `reports:view_own` sees
 * only the actor's own sales of one location, without costs, and only in the
 * summary (D4). Owner and Manager hold both: wherever `reports:view` covers the
 * location it wins, so they always get the full location report.
 */

/**
 * Scope of a report on one location, checked before any read. `allowOwn` is true
 * only for the summary. Throws `PermissionDenied` (403) when neither applies.
 */
export function reportScopeAt(effective: EffectivePermissions, locationId: string, allowOwn: boolean): ReportScope {
  if (can(effective, 'reports:view', locationId)) return 'location';
  if (allowOwn && can(effective, 'reports:view_own', locationId)) return 'own';
  throw new PermissionDenied('reports:view');
}

/** "All my locations" needs `reports:view` somewhere; checked before any read. */
export function assertReportsSomewhere(effective: EffectivePermissions): void {
  if (!hasPermissionAnywhere(effective, 'reports:view')) throw new PermissionDenied('reports:view');
}

/**
 * The active locations where the actor has `reports:view` (all of them with a
 * tenant-wide grant). Empty means 403: there is nothing the actor may aggregate.
 */
export function reportableLocations<T extends { readonly id: string }>(effective: EffectivePermissions, active: readonly T[]): T[] {
  const visible = active.filter((location) => can(effective, 'reports:view', location.id));
  if (visible.length === 0) throw new PermissionDenied('reports:view');
  return visible;
}

import { z } from 'zod';

import { Uuid } from '../common';
import { AssignmentScope } from './scope';

export const AssignmentInput = z.object({ roleId: Uuid, scope: AssignmentScope }).meta({ id: 'AssignmentInput' });
export type AssignmentInput = z.infer<typeof AssignmentInput>;

export const Assignment = z.object({ id: Uuid, roleId: Uuid, scope: AssignmentScope }).meta({ id: 'Assignment' });
export type Assignment = z.infer<typeof Assignment>;

/** PUT /users/:id/assignments replaces the whole set atomically. An empty list removes all. */
const assignmentKey = ({ roleId, scope }: AssignmentInput): string =>
  scope.type === 'tenant' ? `${roleId}|tenant` : `${roleId}|locations|${[...scope.locationIds].sort().join(',')}`;

export const ReplaceAssignmentsRequest = z
  .object({
    assignments: z
      .array(AssignmentInput)
      .max(50)
      .refine((items) => new Set(items.map(assignmentKey)).size === items.length, 'assignments must be unique'),
  })
  .meta({ id: 'ReplaceAssignmentsRequest' });
export type ReplaceAssignmentsRequest = z.infer<typeof ReplaceAssignmentsRequest>;

export const ReplaceAssignmentsResponse = z
  .object({ assignments: z.array(Assignment) })
  .meta({ id: 'ReplaceAssignmentsResponse' });
export type ReplaceAssignmentsResponse = z.infer<typeof ReplaceAssignmentsResponse>;

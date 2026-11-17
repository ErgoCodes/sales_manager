/** Result of a back-office Server Action, as rendered by `FormDialog`. */
export interface ActionState {
  error?: string;
  done?: boolean;
  /** Shown once and never persisted: it lives only in this action result (React state of the open dialog). */
  temporaryPassword?: { value: string; expiresAt: string; email?: string };
}

export const IDLE: ActionState = {};

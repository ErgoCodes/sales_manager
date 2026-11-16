'use client';

import { useActionState, useState, type ReactNode } from 'react';
import type { ActionState } from '@/lib/action-state';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TemporaryPasswordNotice } from './temporary-password-notice';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface FormDialogProps {
  trigger: string;
  title: string;
  description?: string;
  submitLabel: string;
  action: Action;
  /** Form fields (hidden ids included). Absent for plain confirmations. */
  children?: ReactNode;
  destructive?: boolean;
  triggerVariant?: 'default' | 'outline' | 'ghost';
}

/**
 * Button + dialog + Server Action form. The form state lives inside the dialog content, so closing the
 * dialog unmounts it and discards any temporary password that was shown.
 */
export function FormDialog({ trigger, triggerVariant = 'outline', destructive, ...rest }: FormDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={destructive ? 'destructive' : triggerVariant}>
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <FormDialogBody {...rest} destructive={destructive} close={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function FormDialogBody({ title, description, submitLabel, action, children, destructive, close }: Omit<FormDialogProps, 'trigger' | 'triggerVariant'> & { close: () => void }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const next = await action(prev, formData);
    if (next.done && !next.temporaryPassword) close();
    return next;
  }, {});

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
      </DialogHeader>
      {state.temporaryPassword ? (
        <>
          <TemporaryPasswordNotice email={state.temporaryPassword.email} password={state.temporaryPassword.value} expiresAt={state.temporaryPassword.expiresAt} />
          <DialogFooter>
            <Button type="button" onClick={close}>
              Cerrar
            </Button>
          </DialogFooter>
        </>
      ) : (
        <form action={formAction} className="space-y-4">
          {children}
          {state.error ? (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} variant={destructive ? 'destructive' : 'default'}>
              {pending ? 'Procesando…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}

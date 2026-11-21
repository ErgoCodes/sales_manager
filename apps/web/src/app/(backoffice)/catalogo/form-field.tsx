import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/** Native select styled like `Input`: posts with the form and needs no client-side portal. */
export const SELECT_CLASS = 'h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none md:text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Label + control + optional hint + field error (announced and linked with `aria-describedby`). */
export function FormField({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <div className="text-xs opacity-70">{hint}</div> : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Props that tie a control to its `FormField` error. */
export function errorProps(id: string, error: string | undefined) {
  return error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {};
}

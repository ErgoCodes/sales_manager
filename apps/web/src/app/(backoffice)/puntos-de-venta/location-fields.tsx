import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LocationFields({ id, name, code }: { id?: string; name?: string; code?: string }) {
  return (
    <>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="space-y-1">
        <Label htmlFor={`name-${id ?? 'new'}`}>Nombre</Label>
        <Input id={`name-${id ?? 'new'}`} name="name" defaultValue={name} maxLength={100} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`code-${id ?? 'new'}`}>Código</Label>
        <Input id={`code-${id ?? 'new'}`} name="code" defaultValue={code} maxLength={32} pattern="[A-Za-z0-9_\-]{1,32}" required />
        <p className="text-xs opacity-70">Letras, números, &quot;-&quot; y &quot;_&quot;. Único en el negocio.</p>
      </div>
    </>
  );
}

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function UserFields() {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="user-email">Correo electrónico</Label>
        <Input id="user-email" name="email" type="email" maxLength={254} autoComplete="off" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="user-name">Nombre</Label>
        <Input id="user-name" name="displayName" maxLength={100} autoComplete="off" required />
      </div>
      <p className="text-xs opacity-70">Se generará una contraseña temporal que verás una sola vez.</p>
    </>
  );
}

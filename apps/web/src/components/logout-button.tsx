import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** POST form (never a link): logout changes state, so it must not be reachable by GET. */
export function LogoutButton() {
  return (
    <form method="post" action="/logout">
      <Button type="submit" variant="ghost" size="sm">
        <LogOut aria-hidden />
        Cerrar sesión
      </Button>
    </form>
  );
}

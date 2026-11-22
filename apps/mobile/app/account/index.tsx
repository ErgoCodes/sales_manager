import { useState } from 'react';
import { ScrollView } from 'react-native';

import { AccountGate } from '@/components/account/account-gate';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useAppColors } from '@/hooks/use-app-colors';
import { session } from '@/lib/session';
import { useSession } from '@/lib/session/react';

function AccountDetails() {
  const c = useAppColors();
  const state = useSession();
  const [signingOut, setSigningOut] = useState(false);
  if (state.status !== 'signedIn') return null;
  const { user, tenant } = state.me;

  async function handleLogout() {
    setSigningOut(true);
    try {
      await session.logout();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ gap: 6 }}>
        <Text variant="overline">Usuario</Text>
        <Text variant="heading">{user.displayName}</Text>
        <Text variant="caption">{user.email}</Text>
      </Card>
      <Card style={{ gap: 6 }}>
        <Text variant="overline">Negocio</Text>
        <Text variant="heading">{tenant.name}</Text>
      </Card>
      <Button label="Cerrar sesión" variant="destructive" onPress={handleLogout} loading={signingOut} />
    </ScrollView>
  );
}

export default function AccountScreen() {
  return (
    <AccountGate route="/account">
      <AccountDetails />
    </AccountGate>
  );
}

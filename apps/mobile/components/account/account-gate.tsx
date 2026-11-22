import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useAppColors } from '@/hooks/use-app-colors';
import { API_URL } from '@/lib/api/config';
import { accountRouteFor, session, type AccountRoute } from '@/lib/session';
import { useSession } from '@/lib/session/react';

function Centered({ children }: { children: ReactNode }) {
  const c = useAppColors();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {children}
    </ScrollView>
  );
}

/**
 * Renders `children` only when the session belongs on `route`; otherwise redirects to the
 * screen the session state requires (a pending password change only reaches its screen).
 */
export function AccountGate({ route, children }: { route: AccountRoute; children: ReactNode }) {
  const state = useSession();

  if (state.status === 'unsupported') {
    return (
      <Centered>
        <Card style={{ gap: 8 }}>
          <Text variant="heading">Cuenta en línea</Text>
          <Text variant="caption">Disponible en Android e iOS.</Text>
        </Card>
      </Centered>
    );
  }

  if (!API_URL) {
    return (
      <Centered>
        <Card style={{ gap: 8 }}>
          <Text variant="heading">Servidor no configurado</Text>
          <Text variant="caption">Esta versión de la aplicación no tiene configurada la dirección del servidor.</Text>
        </Card>
      </Centered>
    );
  }

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.status === 'unreachable') {
    return (
      <Centered>
        <Card style={{ gap: 12 }}>
          <Text variant="heading">Sin conexión</Text>
          <Text variant="caption">No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.</Text>
          <Button label="Reintentar" variant="soft" onPress={() => void session.restore()} />
          <Button label="Cerrar sesión" variant="ghost" onPress={() => void session.logout()} />
        </Card>
      </Centered>
    );
  }

  const target = accountRouteFor(state);
  if (target && target !== route) return <Redirect href={target} />;
  return <>{children}</>;
}

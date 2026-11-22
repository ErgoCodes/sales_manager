import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';

import { AccountGate } from '@/components/account/account-gate';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';
import { useAppColors } from '@/hooks/use-app-colors';
import { useTodayReport } from '@/hooks/use-today-report';
import { todayView } from '@/lib/reports/today';
import type { Me } from '@/lib/session';
import { useSession } from '@/lib/session/react';

function OfflineBanner({ label }: { label: string }) {
  const c = useAppColors();
  return (
    <View style={{ backgroundColor: c.warningSoft, borderRadius: 12, padding: 12 }} accessibilityRole="alert">
      <Text variant="label" style={{ color: c.warningDark }}>
        {label}
      </Text>
    </View>
  );
}

function TodayReport({ me }: { me: Me }) {
  const c = useAppColors();
  const { locations, selected, select, state, refreshing, refresh } = useTodayReport(me);

  if (locations.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  const view = todayView(state);
  const offline = locations.status === 'offline' || (locations.status === 'ready' && locations.offline);
  const notice = view.notice ?? (offline ? 'Sin conexión' : null);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      {notice ? <OfflineBanner label={notice} /> : null}

      {locations.status === 'offline' ? (
        <Card style={{ gap: 12 }}>
          <Text variant="caption">No se pudo conectar con el servidor.</Text>
          <Button label="Reintentar" variant="soft" onPress={refresh} />
        </Card>
      ) : locations.locations.length === 0 ? (
        <Card>
          <Text variant="caption">No tienes permiso para ver reportes en ningún punto de venta.</Text>
        </Card>
      ) : (
        <>
          {locations.locations.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {locations.locations.map((l) => (
                <Chip key={l.id} label={l.name} active={l.id === selected?.id} onPress={() => select(l.id)} />
              ))}
            </ScrollView>
          ) : (
            <Text variant="heading">{selected?.name}</Text>
          )}

          {view.header ? <Text variant="caption">{view.header}</Text> : null}

          {state.status === 'loading' ? <ActivityIndicator /> : null}

          {view.message ? (
            <Card style={{ gap: 12 }}>
              <Text variant="caption">{view.message}</Text>
              {state.status === 'offline' ? <Button label="Reintentar" variant="soft" onPress={refresh} /> : null}
            </Card>
          ) : null}

          {view.currencies.map((card) => (
            <Card key={card.currency} style={{ gap: 8 }}>
              <Text variant="overline">{`Ventas de hoy · ${card.currency}`}</Text>
              {card.rows.map((row) => (
                <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                  <Text variant="body">{row.label}</Text>
                  <Text variant="body" tabular>
                    {row.value}
                  </Text>
                </View>
              ))}
            </Card>
          ))}

          {view.health?.map((list) => (
            <Card key={list.title} style={{ gap: 8 }}>
              <Text variant="overline">{`${list.title} · ${list.count}`}</Text>
              {list.items.length === 0 ? <Text variant="caption">Ninguno.</Text> : null}
              {list.items.map((item) => (
                <View key={item.key} style={{ gap: 2 }}>
                  <Text variant="body">{item.name}</Text>
                  <Text variant="caption">{item.detail}</Text>
                </View>
              ))}
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function TodayContent() {
  const state = useSession();
  if (state.status !== 'signedIn') return null;
  return <TodayReport me={state.me} />;
}

export default function TodayScreen() {
  return (
    <AccountGate route="/account/today">
      <TodayContent />
    </AccountGate>
  );
}

import { Tabs, router } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';

interface HeaderIconButtonProps {
  name: Parameters<typeof IconSymbol>[0]['name'];
  onPress: () => void;
  accessibilityLabel: string;
}

function HeaderIconButton({ name, onPress, accessibilityLabel }: HeaderIconButtonProps) {
  return (
    <Pressable
      hitSlop={10}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? Colors.light.border : Colors.light.surfaceMuted,
        borderCurve: 'continuous',
      })}
    >
      <IconSymbol name={name} size={20} color={Colors.light.tint} />
    </Pressable>
  );
}

export default function TabLayout() {
  const tint = Colors.light.tint;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tint,
        tabBarInactiveTintColor: Colors.light.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        headerStyle: { backgroundColor: Colors.light.surface },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700', fontSize: 18, color: Colors.light.text },
        headerTitleAlign: 'left',
        tabBarStyle: {
          borderTopColor: Colors.light.border,
          backgroundColor: Colors.light.surface,
          paddingTop: 6,
          height: 64,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          headerShown: true,
          headerTitle: 'Mercado Mónaco',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
          headerRight: () => (
            <View style={{ marginRight: 16 }}>
              <HeaderIconButton
                name="gearshape.fill"
                onPress={() => router.push('/configuration')}
                accessibilityLabel="Configuración"
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventario',
          headerShown: true,
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="shippingbox.fill" color={color} />,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 8, marginRight: 16 }}>
              <HeaderIconButton
                name="square.grid.2x2"
                onPress={() => router.push('/catalog')}
                accessibilityLabel="Catálogo"
              />
              <HeaderIconButton
                name="clock.arrow.circlepath"
                onPress={() => router.push('/inventory/history')}
                accessibilityLabel="Historial de entradas"
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: 'Ventas',
          headerShown: true,
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="cart.fill" color={color} />,
          headerRight: () => (
            <View style={{ marginRight: 16 }}>
              <HeaderIconButton
                name="clock.arrow.circlepath"
                onPress={() => router.push('/sales/history')}
                accessibilityLabel="Historial de ventas"
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: 'Gastos',
          headerShown: true,
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="dollarsign.circle.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reportes',
          headerShown: true,
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="chart.bar.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}

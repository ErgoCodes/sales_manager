import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { StatCard } from '@/components/ui/stat-card';
import { Colors, Semantic, Shadows, Radius, FontSize, Overlay } from '@/constants/theme';
import { countLowStock, getDailySummary, type DailySummary } from '@/db/queries';
import { formatCurrency } from '@/lib/format';

const EMPTY_SUMMARY: DailySummary = { cash: 0, transfer: 0, total: 0, profit: 0 };



interface QuickActionProps {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  label: string;
  onPress: () => void;
  accent: string;
  bg: string;
}

function QuickAction({ icon, label, onPress, accent, bg }: QuickActionProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: Colors.light.surface,
        borderRadius: Radius.xl,
        paddingVertical: 14,
        alignItems: 'center',
        gap: 8,
        borderCurve: 'continuous',
        boxShadow: Shadows.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: Radius.md,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          borderCurve: 'continuous',
        }}
      >
        <IconSymbol name={icon} size={20} color={accent} />
      </View>
      <Text style={{ fontSize: FontSize.sm, fontWeight: '600', color: Colors.light.text, textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const [summary, setSummary] = useState<DailySummary>(EMPTY_SUMMARY);
  const [lowStockCount, setLowStockCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const today = format(new Date(), 'yyyy-MM-dd');
      (async () => {
        const [s, lsc] = await Promise.all([getDailySummary(today), countLowStock()]);
        if (active) {
          setSummary(s);
          setLowStockCount(lsc);
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const today = format(new Date(), "EEEE d 'de' MMMM", { locale: es });
  const todayCap = today.charAt(0).toUpperCase() + today.slice(1);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors.light.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      {/* Greeting */}
      <Animated.View entering={FadeInDown.duration(380).springify()}>
        <Text style={{ fontSize: FontSize.md, color: Colors.light.tabIconDefault, fontWeight: '500', letterSpacing: 0.3 }}>
          {todayCap}
        </Text>
        <Text style={{ fontSize: FontSize['2xl'], fontWeight: '700', color: Colors.light.text, marginTop: 2 }}>
          Resumen del día
        </Text>
      </Animated.View>

      {/* HERO Card */}
      <Animated.View entering={FadeInDown.delay(60).duration(380).springify()}>
        <Pressable
          onPress={() => router.push('/(tabs)/sales')}
          style={({ pressed }) => ({
            backgroundColor: Colors.light.tint,
            borderRadius: Radius.xl,
            padding: 22,
            gap: 6,
            borderCurve: 'continuous',
            boxShadow: Shadows.hero,
            opacity: pressed ? 0.92 : 1,
            overflow: 'hidden',
          })}
        >
          {/* Decorative orb */}
          <View
            style={{
              position: 'absolute',
              right: -40,
              top: -40,
              width: 160,
              height: 160,
              borderRadius: 80,
              backgroundColor: Overlay.light,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: 30,
              bottom: -50,
              width: 110,
              height: 110,
              borderRadius: 55,
              backgroundColor: Overlay.subtle,
            }}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text
              style={{
                fontSize: FontSize.xs,
                fontWeight: '700',
                letterSpacing: 1,
                color: Overlay.text,
                textTransform: 'uppercase',
              }}
            >
              Total del día
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: Overlay.medium,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
              }}
            >
              <Text style={{ fontSize: FontSize.xs, fontWeight: '600', color: Colors.light.surface }}>Ver desglose</Text>
              <IconSymbol name="arrow.up.right" size={11} color={Colors.light.surface} />
            </View>
          </View>

          <Text
            selectable
            style={{
              fontSize: FontSize['4xl'],
              fontWeight: '800',
              color: Colors.light.surface,
              letterSpacing: -1.2,
              marginTop: 6,
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatCurrency(summary.total)}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: Overlay.medium,
            }}
          >
            <IconSymbol name="sparkles" size={14} color={Overlay.textStrong} />
            <Text style={{ fontSize: FontSize.md, color: Overlay.textStrong, fontWeight: '500' }}>
              Utilidad
            </Text>
            <Text
              style={{
                fontSize: FontSize.md,
                fontWeight: '700',
                color: Colors.light.surface,
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatCurrency(summary.profit)}
            </Text>
          </View>
        </Pressable>
      </Animated.View>

      {/* Stats grid */}
      <Animated.View
        entering={FadeInDown.delay(120).duration(380).springify()}
        style={{ flexDirection: 'row', gap: 12 }}
      >
        <StatCard
          label="Efectivo"
          value={formatCurrency(summary.cash)}
          accent={Semantic.cash}
          iconBg={Semantic.cashSoft}
          icon="dollarsign.circle.fill"
        />
        <StatCard
          label="Transferencia"
          value={formatCurrency(summary.transfer)}
          accent={Semantic.transfer}
          iconBg={Semantic.transferSoft}
          icon="arrow.left.arrow.right.circle.fill"
        />
      </Animated.View>

      {/* Quick actions */}
      <Animated.View entering={FadeInDown.delay(180).duration(380).springify()} style={{ gap: 10 }}>
        <Text
          style={{
            fontSize: FontSize.xs,
            fontWeight: '700',
            color: Colors.light.textMuted,
            letterSpacing: 1,
            textTransform: 'uppercase',
            marginLeft: 4,
          }}
        >
          Acciones rápidas
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <QuickAction
            icon="cart.fill"
            label="Nueva venta"
            onPress={() => router.push('/sales/new-session')}
            accent={Semantic.cash}
            bg={Semantic.cashSoft}
          />
          <QuickAction
            icon="shippingbox.fill"
            label="Entrada"
            onPress={() => router.push('/inventory/stock-entry')}
            accent={Semantic.transfer}
            bg={Semantic.transferSoft}
          />
          <QuickAction
            icon="square.grid.2x2"
            label="Catálogo"
            onPress={() => router.push('/catalog')}
            accent={Colors.light.tint}
            bg={Semantic.tealSoft}
          />
        </View>
      </Animated.View>

      {/* Low stock alert */}
      <Animated.View entering={FadeInDown.delay(240).duration(380).springify()}>
        {lowStockCount > 0 ? (
          <Pressable
            onPress={() => router.push('/(tabs)/inventory')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: Semantic.dangerSoft,
              borderRadius: Radius.xl,
              padding: 14,
              borderCurve: 'continuous',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: Radius.md,
                backgroundColor: Semantic.danger,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconSymbol name="exclamationmark.triangle.fill" size={20} color={Colors.light.surface} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: FontSize.base, fontWeight: '700', color: Semantic.dangerDark }}>
                Stock bajo en {lowStockCount} producto{lowStockCount > 1 ? 's' : ''}
              </Text>
              <Text style={{ fontSize: FontSize.sm, color: Semantic.dangerDark, marginTop: 2 }}>
                Toca para revisar el inventario
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={18} color={Semantic.danger} />
          </Pressable>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: Colors.light.surface,
              borderRadius: Radius.xl,
              padding: 14,
              borderCurve: 'continuous',
              boxShadow: Shadows.sm,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: Radius.md,
                backgroundColor: Semantic.cashSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <IconSymbol name="checkmark.circle.fill" size={20} color={Semantic.cash} />
            </View>
            <Text style={{ fontSize: FontSize.md, color: Semantic.neutral, fontWeight: '500', flex: 1 }}>
              Inventario en orden — sin alertas
            </Text>
          </View>
        )}
      </Animated.View>
    </ScrollView>
  );
}

import { format } from 'date-fns';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { contarStockBajo, resumenDelDia, type ResumenDia } from '@/db/queries';

const RESUMEN_VACIO: ResumenDia = { efectivo: 0, transferencia: 0, total: 0, utilidad: 0 };

function formatMoneda(valor: number): string {
  return `$${valor.toLocaleString('es-CU', { maximumFractionDigits: 2 })}`;
}

export default function InicioScreen() {
  const [resumen, setResumen] = useState<ResumenDia>(RESUMEN_VACIO);
  const [stockBajo, setStockBajo] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let activo = true;
      const hoy = format(new Date(), 'yyyy-MM-dd');
      (async () => {
        const [r, sb] = await Promise.all([resumenDelDia(hoy), contarStockBajo()]);
        if (activo) {
          setResumen(r);
          setStockBajo(sb);
        }
      })();
      return () => {
        activo = false;
      };
    }, []),
  );

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4 gap-4">
      <Text variant="title">Resumen de hoy</Text>

      <View className="flex-row gap-3">
        <View className="flex-1 rounded-xl bg-white p-4 shadow-sm">
          <Text variant="caption">Efectivo</Text>
          <Text variant="heading" className="text-green-700">
            {formatMoneda(resumen.efectivo)}
          </Text>
        </View>
        <View className="flex-1 rounded-xl bg-white p-4 shadow-sm">
          <Text variant="caption">Transferencia</Text>
          <Text variant="heading" className="text-blue-700">
            {formatMoneda(resumen.transferencia)}
          </Text>
        </View>
      </View>

      <View className="rounded-xl bg-white p-4 shadow-sm gap-1">
        <Text variant="caption">Total del día</Text>
        <Text variant="title">{formatMoneda(resumen.total)}</Text>
        <Text variant="label" className="text-gray-500">
          Utilidad: {formatMoneda(resumen.utilidad)}
        </Text>
      </View>

      <View
        className={`rounded-xl p-4 ${stockBajo > 0 ? 'bg-red-50' : 'bg-white'} shadow-sm`}>
        <Text variant="label" className={stockBajo > 0 ? 'text-red-700' : 'text-gray-500'}>
          {stockBajo > 0
            ? `⚠️ ${stockBajo} producto(s) con stock bajo`
            : 'Sin alertas de stock bajo'}
        </Text>
      </View>
    </ScrollView>
  );
}

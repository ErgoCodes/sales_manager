import { router } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

export default function InventarioScreen() {
  return (
    <View className="flex-1 bg-gray-50 p-6 gap-6">
      <View className="gap-1">
        <Text variant="title">Inventario</Text>
        <Text variant="caption">El stock en tiempo real llega en T-07.</Text>
      </View>

      <View className="gap-3">
        <Button label="Catálogo de productos" onPress={() => router.push('/catalogo')} />
        <Button
          label="Registrar entrada"
          variant="outline"
          onPress={() => router.push('/inventario/entrada')}
        />
        <Button
          label="Historial de entradas"
          variant="ghost"
          onPress={() => router.push('/inventario/historial')}
        />
      </View>
    </View>
  );
}

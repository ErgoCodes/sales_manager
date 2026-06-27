import { View } from 'react-native';

import { Text } from '@/components/ui/text';

export default function InventarioScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-gray-50 p-6 gap-2">
      <Text variant="title">Inventario</Text>
      <Text variant="caption">Próximamente (T-06, T-07)</Text>
    </View>
  );
}

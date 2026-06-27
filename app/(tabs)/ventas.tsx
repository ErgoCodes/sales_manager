import { View } from 'react-native';

import { Text } from '@/components/ui/text';

export default function VentasScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-gray-50 p-6 gap-2">
      <Text variant="title">Ventas</Text>
      <Text variant="caption">Próximamente (T-09, T-11)</Text>
    </View>
  );
}

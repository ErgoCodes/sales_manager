import { View } from 'react-native';

import { Text } from '@/components/ui/text';

export default function GastosScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-gray-50 p-6 gap-2">
      <Text variant="title">Gastos</Text>
      <Text variant="caption">Próximamente (T-13, T-14)</Text>
    </View>
  );
}

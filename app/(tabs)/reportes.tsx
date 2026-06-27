import { View } from 'react-native';

import { Text } from '@/components/ui/text';

export default function ReportesScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-gray-50 p-6 gap-2">
      <Text variant="title">Reportes</Text>
      <Text variant="caption">Próximamente (T-16 a T-20)</Text>
    </View>
  );
}

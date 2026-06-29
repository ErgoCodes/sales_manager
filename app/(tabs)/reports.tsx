import { View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { Colors } from '@/constants/theme';

export default function ReportsScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background, justifyContent: 'center' }}>
      <EmptyState
        icon="chart.bar.fill"
        title="Reportes"
        description="Reportes diarios, semanales y mensuales con rankings de productos, pérdidas y exportación a PDF / WhatsApp."
        badge="Próximamente"
      />
    </View>
  );
}

import { View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { useAppColors } from '@/hooks/use-app-colors';

export default function ReportsScreen() {
  const c = useAppColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
      <EmptyState
        icon="chart.bar.fill"
        title="Reportes"
        description="Reportes diarios, semanales y mensuales con rankings de productos, pérdidas y exportación a PDF / WhatsApp."
        badge="Próximamente"
      />
    </View>
  );
}

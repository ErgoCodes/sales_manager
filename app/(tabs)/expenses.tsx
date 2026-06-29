import { View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { Colors } from '@/constants/theme';

export default function ExpensesScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background, justifyContent: 'center' }}>
      <EmptyState
        icon="dollarsign.circle.fill"
        title="Gastos"
        description="Registra salarios, multas, impuestos y retiros del propietario. Próximamente podrás ver el impacto sobre la ganancia neta."
        badge="Próximamente"
      />
    </View>
  );
}

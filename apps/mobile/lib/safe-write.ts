import { Alert } from 'react-native';

export async function safeWrite<T>(
  action: () => Promise<T> | T,
  errorTitle = 'No se pudo guardar',
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await action() };
  } catch (e) {
    console.error(errorTitle, e);
    Alert.alert(errorTitle, 'Revisa los datos e inténtalo de nuevo. Si el problema sigue, reinicia la app.');
    return { ok: false };
  }
}

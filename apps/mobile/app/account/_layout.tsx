import { Stack } from 'expo-router';

export default function AccountLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Cuenta en línea' }} />
      <Stack.Screen name="login" options={{ title: 'Iniciar sesión' }} />
      <Stack.Screen name="today" options={{ title: 'Hoy' }} />
      <Stack.Screen name="change-password" options={{ title: 'Cambiar contraseña', gestureEnabled: false }} />
    </Stack>
  );
}

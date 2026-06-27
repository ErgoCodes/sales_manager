import * as Notifications from 'expo-notifications';

export async function requestPermissions() {
  // expo-notifications importa PermissionResponse desde 'expo', que no lo exporta,
  // por lo que el tipo pierde `granted`/`status`. El objeto sí los trae en runtime.
  const response = (await Notifications.requestPermissionsAsync()) as { granted: boolean };
  return response.granted;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

import * as Notifications from 'expo-notifications';

export async function requestPermissions() {
  // expo-notifications importa PermissionResponse desde 'expo', que no lo exporta,
  // por lo que el tipo pierde `granted`/`status`. El objeto sí los trae en runtime.
  const response = (await Notifications.requestPermissionsAsync()) as { granted: boolean };
  return response.granted;
}

/**
 * Programa el recordatorio semanal de los lunes a las 9:00 para generar y
 * compartir el reporte semanal con Pupo (T-17). El trigger `WEEKLY` de
 * expo-notifications usa `weekday` con domingo = 1, por lo que lunes = 2.
 * Debe programarse una sola vez (gateada por la config del llamador); las
 * notificaciones locales recurrentes solo llegan de forma fiable en un
 * development build, no en Expo Go (SDK 53+).
 */
export async function scheduleWeeklyReminder() {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Reporte semanal',
      body: 'Genera y comparte el reporte semanal con Pupo',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 2,
      hour: 9,
      minute: 0,
    },
  });
}

/**
 * Programa un recordatorio semanal de respaldo los domingos a las 20:00.
 * Usa weekday = 1 (domingo) en el trigger WEEKLY de expo-notifications.
 * Debe programarse una sola vez (gateada por CONFIG_KEYS.backupReminderScheduled).
 */
export async function scheduleBackupReminder() {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Respaldo semanal',
      body: 'Realiza un respaldo de seguridad de tus datos hoy.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1, // Sunday
      hour: 20,
      minute: 0,
    },
  });
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

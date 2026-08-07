import { useEffect } from "react";

import { CONFIG_KEYS, getConfig, setConfig } from "@/db/config";
import {
  requestPermissions,
  scheduleBackupReminder,
  scheduleWeeklyReminder,
} from "@/lib/notifications";

/**
 * Programa los recordatorios locales recurrentes (reporte semanal + respaldo)
 * una sola vez, gateados por flags en la tabla de configuración.
 * Debe llamarse solo después de que las migraciones de DB hayan finalizado.
 */
export function useScheduleReminders(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;

    (async () => {
      const weeklyFlag = await getConfig(CONFIG_KEYS.weeklyReminderScheduled);
      const backupFlag = await getConfig(CONFIG_KEYS.backupReminderScheduled);
      if (!active) return;

      const needsWeekly = weeklyFlag !== "1";
      const needsBackup = backupFlag !== "1";
      if (!needsWeekly && !needsBackup) return;

      const granted = await requestPermissions();
      if (!granted || !active) return;

      if (needsWeekly) {
        await scheduleWeeklyReminder();
        await setConfig(CONFIG_KEYS.weeklyReminderScheduled, "1");
      }
      if (needsBackup) {
        await scheduleBackupReminder();
        await setConfig(CONFIG_KEYS.backupReminderScheduled, "1");
      }
    })();

    return () => {
      active = false;
    };
  }, [enabled]);
}

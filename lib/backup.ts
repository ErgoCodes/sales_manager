import { format } from 'date-fns';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { db } from '@/db/client';
import { CONFIG_KEYS, setConfig } from '@/db/config';

// Los 16 primeros bytes de todo archivo SQLite 3 son este header fijo.
const SQLITE_HEADER = new Uint8Array([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]);

export class BackupCancelledError extends Error {
  constructor() {
    super('Selección de archivo cancelada.');
    this.name = 'BackupCancelledError';
  }
}

// db.$client.databasePath es una ruta de filesystem "pelada" (sin esquema),
// pero el constructor de `File` necesita un URI file:// para resolverla bien.
function toFileUri(path: string): string {
  return path.startsWith('file:') ? path : `file://${path}`;
}

export async function exportBackup(): Promise<void> {
  // SQLite en modo WAL mantiene escrituras recientes en un archivo -wal aparte;
  // sin este checkpoint el db.sqlite copiado podría faltarle datos recientes.
  await db.$client.execAsync('PRAGMA wal_checkpoint(FULL);');

  const sourceFile = new File(toFileUri(db.$client.databasePath));
  if (!sourceFile.exists) {
    throw new Error('No se encontró la base de datos para respaldar.');
  }

  const backupName = `respaldo_monaco_${format(new Date(), 'yyyy-MM-dd')}.db`;
  const backupFile = new File(Paths.cache, backupName);
  if (backupFile.exists) {
    // Reintentar el mismo día pisaría un respaldo previo con el mismo nombre.
    backupFile.delete();
  }
  sourceFile.copy(backupFile);

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Compartir archivos no está disponible en este dispositivo.');
  }
  await Sharing.shareAsync(backupFile.uri);

  await setConfig(CONFIG_KEYS.lastBackup, format(new Date(), 'yyyy-MM-dd'));
}

export async function pickAndValidateBackupFile(): Promise<DocumentPicker.DocumentPickerAsset> {
  let result: DocumentPicker.DocumentPickerResult;
  try {
    result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  } catch {
    throw new Error('No se pudo abrir el selector de archivos. Verifica los permisos de almacenamiento.');
  }
  if (result.canceled) {
    throw new BackupCancelledError();
  }

  const asset = result.assets[0];
  const file = new File(asset.uri);
  if (!file.exists) {
    throw new Error('El archivo seleccionado ya no existe.');
  }

  const handle = file.open();
  let header: Uint8Array;
  try {
    header = handle.readBytes(16);
  } finally {
    handle.close();
  }
  const isValidSqlite = header.length === 16 && SQLITE_HEADER.every((byte, i) => header[i] === byte);
  if (!isValidSqlite) {
    throw new Error('El archivo seleccionado no es una base de datos SQLite válida.');
  }

  return asset;
}

// Ejecuta el reemplazo real. Debe llamarse solo después de una confirmación
// explícita del usuario en la UI — esta operación es irreversible.
export async function restoreBackup(asset: DocumentPicker.DocumentPickerAsset): Promise<void> {
  const dbPath = db.$client.databasePath;
  // Hay que cerrar la conexión activa antes de pisar el archivo; si no,
  // SQLite puede seguir escribiendo sobre el archivo restaurado.
  db.$client.closeSync();

  const sourceFile = new File(asset.uri);
  const targetFile = new File(toFileUri(dbPath));
  const bytes = await sourceFile.bytes();
  // `write` trunca y sobrescribe el contenido existente, a diferencia de
  // `copy`, que falla si el destino ya existe.
  targetFile.write(bytes);
}

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface Sheet {
  name: string;
  /** Primera fila = encabezados; el resto, datos. Números como `number`. */
  rows: (string | number)[][];
}

/**
 * Arma un libro `.xlsx` con SheetJS, lo escribe en la caché y abre el share
 * sheet nativo. SheetJS es JS puro; el binario se genera como base64 y la API
 * de expo-file-system lo escribe con `encoding: 'base64'` (mismo patrón de
 * escritura/compartir que `lib/backup.ts`).
 */
export async function exportToExcel(filename: string, sheets: Sheet[]): Promise<void> {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    // El nombre de hoja de Excel no admite más de 31 caracteres.
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }

  const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

  const file = new File(Paths.cache, filename);
  if (file.exists) {
    // Reexportar el mismo día pisaría un archivo previo con el mismo nombre.
    file.delete();
  }
  file.write(base64, { encoding: 'base64' });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Compartir archivos no está disponible en este dispositivo.');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: XLSX_MIME,
    dialogTitle: 'Compartir reporte',
  });
}

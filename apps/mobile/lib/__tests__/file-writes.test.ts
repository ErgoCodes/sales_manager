// Since Expo SDK 56/58, `File.copy()` and `File.write()` return a Promise. These tests pin that the
// export and restore flows wait for the file to be fully written before sharing it or finishing.

const mockEvents: string[] = [];
let mockRelease: () => void = () => {};

function mockPending(label: string): Promise<void> {
  mockEvents.push(`${label}:start`);
  return new Promise((resolve) => {
    mockRelease = () => {
      mockEvents.push(`${label}:done`);
      resolve();
    };
  });
}

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: jest.fn().mockImplementation((...parts: string[]) => ({
    uri: parts.join('/'),
    exists: parts[0] !== 'file:///cache',
    delete: jest.fn(),
    copy: jest.fn(() => mockPending('copy')),
    write: jest.fn(() => mockPending('write')),
    bytes: jest.fn(async () => new Uint8Array([1, 2, 3])),
    // "SQLite format 3\0": the 16-byte header every SQLite file starts with.
    open: jest.fn(() => ({
      readBytes: jest.fn(async () => new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00])),
      close: jest.fn(),
    })),
  })),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {
    mockEvents.push('share');
  }),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///picked/respaldo.db', name: 'respaldo.db' }] })),
}));

jest.mock('@/db/client', () => ({
  getExpoDb: () => ({ $client: { databasePath: '/data/db.sqlite', execAsync: jest.fn(async () => undefined), closeSync: jest.fn() } }),
}));

jest.mock('@/db/config', () => ({ CONFIG_KEYS: { lastBackup: 'last_backup' }, setConfig: jest.fn(async () => undefined) }));

import { exportBackup, pickAndValidateBackupFile, restoreBackup } from '../backup';
import { exportToExcel } from '../excel';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mockEvents.length = 0;
});

describe('file writes are awaited', () => {
  it('exportToExcel shares the workbook only after it is written', async () => {
    const done = exportToExcel('reporte.xlsx', [{ name: 'Hoja', rows: [['A'], [1]] }]);
    await flush();
    expect(mockEvents).toEqual(['write:start']);
    mockRelease();
    await done;
    expect(mockEvents).toEqual(['write:start', 'write:done', 'share']);
  });

  it('exportBackup shares the backup only after the copy finishes', async () => {
    const done = exportBackup();
    await flush();
    expect(mockEvents).toEqual(['copy:start']);
    mockRelease();
    await done;
    expect(mockEvents).toEqual(['copy:start', 'copy:done', 'share']);
  });

  it('restoreBackup resolves only after the database file is written', async () => {
    let finished = false;
    const done = restoreBackup({ uri: 'file:///picked/respaldo.db', name: 'respaldo.db' } as never).then(() => {
      finished = true;
    });
    await flush();
    expect(mockEvents).toEqual(['write:start']);
    expect(finished).toBe(false);
    mockRelease();
    await done;
    expect(finished).toBe(true);
  });

  it('pickAndValidateBackupFile accepts a file whose header (read asynchronously) is SQLite', async () => {
    await expect(pickAndValidateBackupFile()).resolves.toEqual({ uri: 'file:///picked/respaldo.db', name: 'respaldo.db' });
  });
});

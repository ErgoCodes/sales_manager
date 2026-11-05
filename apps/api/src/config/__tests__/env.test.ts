import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, loadConfig } from '../env';

const valid = {
  DATABASE_URL: 'postgres://user:secret@localhost:5432/monaco',
  CORS_ORIGINS: 'http://localhost:3000, https://app.example.com',
};

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    expect(loadConfig(valid)).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL: valid.DATABASE_URL,
      CORS_ORIGINS: ['http://localhost:3000', 'https://app.example.com'],
      LOG_LEVEL: 'info',
      APP_VERSION: '0.1.0',
    });
  });

  it('coerces PORT from a string', () => {
    expect(loadConfig({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails fast listing every missing variable', () => {
    expect(() => loadConfig({})).toThrow(InvalidEnvironmentError);
    try {
      loadConfig({});
    } catch (error) {
      const { issues } = error as InvalidEnvironmentError;
      expect(issues.some((issue) => issue.startsWith('DATABASE_URL'))).toBe(true);
      expect(issues.some((issue) => issue.startsWith('CORS_ORIGINS'))).toBe(true);
    }
  });

  it('never echoes values (they may be secrets) in the error', () => {
    const env = { ...valid, DATABASE_URL: 'mysql://user:hunter2@db/monaco' };
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig(env)).not.toThrow(/hunter2/);
  });

  it.each([
    ['*'],
    ['http://localhost:3000/'],
    ['https://app.example.com/path'],
    ['ftp://files.example.com'],
    [' , '],
  ])('rejects CORS_ORIGINS=%j', (origins) => {
    expect(() => loadConfig({ ...valid, CORS_ORIGINS: origins })).toThrow(/CORS_ORIGINS/);
  });

  it.each([['0'], ['65536'], ['abc']])('rejects PORT=%j', (port) => {
    expect(() => loadConfig({ ...valid, PORT: port })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});

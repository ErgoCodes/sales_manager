import type { Clock } from '../domain/auth-ports';

export const systemClock: Clock = { now: () => new Date() };

import 'server-only';
import { cache } from 'react';
import { callApi, requestInit } from './admin';

/** `GET /me`, once per request. Server Components only (no cookie writes, so no refresh here: the proxy did it). */
export const getMe = cache(() => callApi((api) => api.GET('/me', requestInit()), { canRefresh: false }));

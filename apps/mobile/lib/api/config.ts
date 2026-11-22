/**
 * API base URL, set per EAS build profile (`eas.json`) or in `.env.local` for `expo start`.
 * Not a secret: `EXPO_PUBLIC_*` values are inlined in the bundle. Must stay a literal
 * `process.env.EXPO_PUBLIC_API_URL` reference for Expo to inline it.
 */
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

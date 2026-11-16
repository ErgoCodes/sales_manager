'use client';

import { setNonce } from 'get-nonce';
import type { ReactNode } from 'react';

/**
 * Gives the per-request CSP nonce to `get-nonce`, which react-style-singleton (Radix dialog scroll lock) reads
 * when it injects its <style> tag. Without it that tag is blocked by `style-src 'nonce-…'`.
 * Runs during render, before any dialog can mount; setting the same value again is harmless.
 */
export function NonceProvider({ nonce, children }: { nonce: string | undefined; children: ReactNode }) {
  if (nonce) setNonce(nonce);
  return children;
}

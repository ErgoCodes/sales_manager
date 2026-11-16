import { getNonce } from 'get-nonce';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NonceProvider } from '../nonce-provider';

describe('NonceProvider', () => {
  it('hands the per-request nonce to get-nonce, which Radix scroll lock uses for its <style> tag', () => {
    expect(getNonce()).toBeUndefined();
    const html = renderToStaticMarkup(
      <NonceProvider nonce="abc123">
        <p>hijo</p>
      </NonceProvider>,
    );
    expect(getNonce()).toBe('abc123');
    expect(html).toContain('hijo');
  });
});

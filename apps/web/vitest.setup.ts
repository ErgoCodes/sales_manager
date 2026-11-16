import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

// lucide-react ships a nested React copy that differs from web's; icons are decorative in tests.
vi.mock('lucide-react', () => ({
  CheckIcon: () => null,
  ChevronDownIcon: () => null,
  ChevronUpIcon: () => null,
  XIcon: () => null,
}));

// jsdom lacks ResizeObserver, which Radix primitives (checkbox, select) use.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// react-remove-scroll (dialog scroll lock) also resolves its own nested React; the lock is irrelevant in jsdom.
vi.mock('react-remove-scroll', () => ({ RemoveScroll: ({ children }: { children: unknown }) => children }));

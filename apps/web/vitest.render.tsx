import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Minimal render for hook-using components. @testing-library/react ships its own nested React 19.1 (mobile's);
 * this goes through web's React 19.3 (see the aliases in vitest.config.mts). Queries still come from @testing-library/dom.
 */
export function renderWithReact(element: ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export { act };

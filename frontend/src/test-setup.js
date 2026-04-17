import '@testing-library/jest-dom';

// jsdom does not implement ResizeObserver; VirtualTable uses it via MetricsPanel.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import '@testing-library/jest-dom/vitest';

// jsdom gaps for canvas + observers used by the graph.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!HTMLCanvasElement.prototype.getContext) {
  // Minimal mock to prevent d3/canvas code from crashing during render.
  // Individual tests can override as needed.
  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    fillText() {},
  });
}

if (!navigator.clipboard) {
  navigator.clipboard = { writeText: async () => {} };
}

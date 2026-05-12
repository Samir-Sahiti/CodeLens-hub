import '@testing-library/jest-dom/vitest';

// jsdom gaps for canvas + observers used by the graph.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class IntersectionObserver {
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
    setLineDash() {},
    lineDashOffset: 0,
    shadowBlur: 0,
    globalAlpha: 1,
  });
}

if (!navigator.clipboard) {
  navigator.clipboard = { writeText: async () => {} };
}

if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
}

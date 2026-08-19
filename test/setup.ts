import "@testing-library/jest-dom/vitest";

// jsdom pointer-capture API'sini sağlamaz; Radix Select gerçek tarayıcıda bu API'yi kullanır.
Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  releasePointerCapture: { configurable: true, value: () => undefined },
  scrollIntoView: { configurable: true, value: () => undefined },
  setPointerCapture: { configurable: true, value: () => undefined },
});

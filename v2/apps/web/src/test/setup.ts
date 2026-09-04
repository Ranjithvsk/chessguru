// jsdom has no layout engine: every getBoundingClientRect is a 0x0 rect, which makes
// chessground's coordinate maths degenerate. Hand it a fixed 512px square board.
const RECT = { x: 0, y: 0, left: 0, top: 0, right: 512, bottom: 512, width: 512, height: 512, toJSON() {} } as DOMRect;
Element.prototype.getBoundingClientRect = () => RECT;

if (!("ResizeObserver" in globalThis)) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

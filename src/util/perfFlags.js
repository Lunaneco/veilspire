// One switch for the whole performance pass.
//
// Frame cost is only ever an argument you can win with numbers, and numbers
// need a control. Run this in the console and reload to get the pre-pass
// behaviour back — no static batching, no character LOD, no interior culling,
// the full 250m grass box, the wide shadow frustum, MSAA and full-resolution
// bloom — so any change can be measured against it with __game.probe():
//
//   localStorage.setItem('veilspire.legacyPerf', '1')
//
// Clear it (or set it to '0') to go back to the optimized path. The fixed
// point-light pool is not switchable: the old distance cull it replaced
// rebuilt every shader program each time a lamp crossed the range.
export const OPTIMIZED = (() => {
  try { return localStorage.getItem('veilspire.legacyPerf') !== '1'; }
  catch { return true; }
})();

// Picks between an optimized value and the original one.
export const opt = (fast, legacy) => (OPTIMIZED ? fast : legacy);

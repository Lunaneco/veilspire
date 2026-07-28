export function isCompactViewport(width, height) {
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  return shortSide <= 600 && longSide <= 1000;
}

export function prefersTouchLayout() {
  if (typeof window === 'undefined') return false;
  const forced = new URLSearchParams(window.location.search).get('mobile') === '1';
  return forced
    || 'ontouchstart' in window
    || (navigator.maxTouchPoints || 0) > 0
    || window.matchMedia?.('(pointer: coarse)').matches
    || isCompactViewport(window.innerWidth, window.innerHeight);
}

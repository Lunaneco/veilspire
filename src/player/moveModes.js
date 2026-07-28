// Pure locomotion helpers used by Player and unit tests.

export const SWIM_LEVEL_OFFSET = 0.45;

export function isDeepWater(groundY, waterLevel) {
  return groundY < waterLevel - 1.1;
}

export function shouldStartSwim({
  flying, swimming, groundY, waterLevel, y,
}) {
  if (flying || swimming || !isDeepWater(groundY, waterLevel)) return false;
  return y < waterLevel - SWIM_LEVEL_OFFSET + 0.05;
}

export function canToggleFlight(flying, flightLockout) {
  return flying || flightLockout <= 0;
}

export function breakFlightOnHit({ flying, velocityY = 0 }) {
  if (!flying) return { flying: false, velocityY, flightLockout: 0 };
  return {
    flying: false,
    velocityY: Math.min(velocityY, -4.5),
    flightLockout: 1.4,
  };
}

export function canStartClimb({ flying, swimming, climbTimer }) {
  return !flying && !swimming && (climbTimer ?? 0) <= 0;
}

export function shouldMantle(y, topY) {
  return y > topY - 0.35;
}

export function shouldReleaseAtGround(wantDown, y, groundY) {
  return !!(wantDown && y <= groundY + 0.05);
}

export function locomotionMode({
  climbing, flying, swimming, grounded, dodgeTimer,
}) {
  if (climbing) return 'climb';
  if (flying) return 'fly';
  if (swimming) return 'swim';
  if ((dodgeTimer ?? 0) > 0) return 'dodge';
  if (!grounded) return 'air';
  return 'ground';
}

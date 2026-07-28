// Pure combat math shared by wisps, golems, and the Hollow Warden.

export function heavyArmourMul(frozenTimer, base = 0.55) {
  return frozenTimer > 0 ? 1 : base;
}

export function bossArmourMul(frozenTimer) {
  return heavyArmourMul(frozenTimer, 0.7);
}

export function resolveBossHit(state, damage) {
  if (state.dead || state.finisherPlaying) {
    return {
      ...state,
      applied: 0,
      enteredPhaseTwo: false,
      openedFinisher: false,
    };
  }
  const applied = damage * bossArmourMul(state.frozenTimer);
  const hp = state.hp - applied;
  let phase = state.phase;
  let finisherReady = state.finisherReady;
  let nextState = state.state;
  let enteredPhaseTwo = false;
  let openedFinisher = false;

  if (phase === 1 && hp <= state.maxHp * 0.5) {
    phase = 2;
    enteredPhaseTwo = true;
  }
  if (!finisherReady && hp <= state.maxHp * 0.08) {
    finisherReady = true;
    nextState = 'kneel';
    openedFinisher = true;
  }
  return {
    ...state,
    hp,
    phase,
    finisherReady,
    state: nextState,
    applied,
    enteredPhaseTwo,
    openedFinisher,
  };
}

export function resolveGolemHit(state, damage) {
  if (state.dead) return { ...state, applied: 0, dead: true };
  const applied = damage * heavyArmourMul(state.frozenTimer, 0.55);
  const hp = state.hp - applied;
  const dead = hp <= 0;
  return {
    ...state,
    hp,
    applied,
    dead,
    state: dead ? 'dying' : state.state,
  };
}

export function resolveWispHit(state, damage) {
  if (state.dead) return { ...state, applied: 0, dead: true };
  const hp = state.hp - damage;
  const dead = hp <= 0;
  return {
    ...state,
    hp,
    applied: damage,
    dead,
    state: dead ? 'dying' : 'aggro',
    staggerTimer: dead
      ? state.staggerTimer
      : Math.max(state.staggerTimer ?? 0, 0.45),
  };
}

export function flankWaypoint(
  wispX, wispZ, golemX, golemZ, playerX, playerZ, side = 1,
) {
  void wispX;
  void wispZ;
  let px = playerX - golemX;
  let pz = playerZ - golemZ;
  const distance = Math.hypot(px, pz) || 1;
  px /= distance;
  pz /= distance;
  return {
    x: golemX - px * 2.5 + (-pz) * side * 5,
    z: golemZ - pz * 2.5 + px * side * 5,
  };
}

export function burnDps(isGolemOrBoss) {
  return isGolemOrBoss ? 5 : 8;
}

export function canStartFinisher(finisherReady, finisherPlaying, dead) {
  return !!(finisherReady && !finisherPlaying && !dead);
}

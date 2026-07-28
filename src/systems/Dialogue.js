// Contextual chatter. Lines are picked from pools keyed by what is true right
// now: the hour, the weather, and what the player has done.

const GREETING = {
  stranger: [
    'New face at the academy?',
    'Mind the wisps past the treeline.',
    'You have the look of a first-year.',
  ],
  noticed: [
    'You have been out past the wards, haven’t you.',
    'They say someone has been thinning the wisps.',
    'Careful — the forest notices those who fight it.',
  ],
  known: [
    'The professor speaks well of you.',
    'You’re the one who cleared the treeline. Thank you.',
    'Word travels fast in a castle this small.',
  ],
  hero: [
    'You felled the Warden. The whole valley felt it.',
    'They will carve your name into the ring stones.',
    'I saw the light when the Warden fell. Everyone did.',
  ],
};

const BY_HOUR = [
  { from: 5, to: 8, lines: ['Too early for lessons.', 'The mist hasn’t lifted yet.'] },
  { from: 8, to: 12, lines: ['Lessons start soon — don’t be late.', 'I have theory first period.'] },
  { from: 12, to: 15, lines: ['The courtyard is warm today.', 'Have you eaten?'] },
  { from: 15, to: 19, lines: ['Good hour for a walk to the lake.', 'The light is lovely this time of day.'] },
  { from: 19, to: 24, lines: ['Curfew soon.', 'The corridors get strange after dark.'] },
  { from: 0, to: 5, lines: ['You shouldn’t be out at this hour.', 'Did you hear that, out past the wall?'] },
];

const BY_WEATHER = {
  rain: ['This rain will not let up.', 'My robes are soaked through.', 'Inside, quickly — you’ll catch cold.'],
  storm: ['That thunder shook the windows!', 'Get under cover, the sky is angry.', 'Storms like this wake old things.'],
  overcast: ['Gloomy sort of day.', 'Feels like rain coming.'],
};

// Longer exchanges when the player presses F
const CONVERSATION = {
  stranger: 'The academy looks bigger from outside than in — you’ll learn its shortcuts soon enough. ' +
    'Just don’t take the east stair after dark.',
  noticed: 'You have been fighting them, haven’t you? The wisps. My tutor says they thicken ' +
    'wherever the old wards have thinned. Nobody will say why.',
  known: 'Since you cleared the treeline the lanterns stay lit all the way to the gate. ' +
    'Small thing, maybe. It matters to those of us who walk it.',
  hero: 'The Warden stood before the academy did — that is what the oldest books claim. ' +
    'And you brought it down. I am not sure whether to thank you or be frightened.',
};

export function pickGreeting(worldState, hour, weatherState, rng = Math.random) {
  const pools = [];
  // Weather is the most immediate thing to remark on
  if (BY_WEATHER[weatherState]) pools.push(...BY_WEATHER[weatherState]);
  const slot = BY_HOUR.find((h) => hour >= h.from && hour < h.to);
  if (slot) pools.push(...slot.lines);
  pools.push(...GREETING[worldState.standing]);
  // Deeds get double weight so the world feels like it is watching
  pools.push(...GREETING[worldState.standing]);
  return pools[Math.floor(rng() * pools.length)];
}

export function pickConversation(worldState) {
  return CONVERSATION[worldState.standing];
}

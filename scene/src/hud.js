import { inFace } from './wall.js';

// The security camera's overlay: what HR has noted. Pure: main.js puts it on the page.
export const HUD = { every: 7 };   // s each note stays up

export const NOTES = [
  'Subject detected at desk',
  'Productivity: under review',
  'Tab switch logged',
  'Lunch break: 47 min (noted)',
  'Your 1:1 has been moved to Friday 4:55 PM',
  'Smile. It is for the appraisal.',
  'Mouse movement: suspicious',
  'Coffee count today: 4',
  'Reply-all detected',
  '"Quick sync" duration: 58 min',
  'Camera 03 · Green Wall · All clear. For now.',
  'Slack status "Focusing" — unverified',
  'Leaves rustling: not an alibi',
];

/** The note to show at time t (s), given what the scene is doing:
 *  idle: s since the cursor last moved (null when it is off the wall);
 *  near: whether the cursor is on HR's face; rain, snow: the weather modes. */
export function noteAt(t, { idle = null, near = false, rain = 0, snow = 0 } = {}) {
  if (near) return 'Too close. Please step back from HR.';
  if (idle !== null && idle > 60) return `Subject idle for ${Math.floor(idle / 60)} min`;
  const slot = Math.floor(t / HUD.every);
  if (slot % 3 === 1 && rain) return 'Rain is not a valid reason to work from home';
  if (slot % 3 === 1 && snow) return 'Snow day request: denied';
  return NOTES[slot % NOTES.length];
}

/** Whether a wall point is on HR's face. */
export const onFace = (p) => Boolean(p) && inFace(p.x, p.y);

const two = (n) => String(n).padStart(2, '0');
/** The camera's timestamp, as CCTV prints it. */
export function stamp(date) {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

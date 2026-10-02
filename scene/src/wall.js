// Everything the scene knows about the photo, in wall units: pixels of the photo
// scaled to 1600 wide, origin top-left, y pointing down.
export const WALL_W = 1600;
export const WALL_H = 1067;
export const LOGO_BOX = { x0: 228, y0: 452, x1: 1367, y1: 552 };   // the eye mark and HR IS WATCHING
// HR, peeking over the hedge above the sign (assets-src/hr/compose.py put him there): his head
// as an ellipse, and his eyes (centre at the pupil, half width and half height of the opening).
export const FACE = { cx: 806, cy: 250, rx: 120, ry: 148 };
export const EYES = [
  { x: 757.0, y: 254.6, a: 16.5, b: 4.6 },
  { x: 836.8, y: 253.5, a: 16.5, b: 4.6 },
];
// Printed by `npm run photo` (assets-src/prepare-photo.sh), which levels the ceiling.
export const LIGHTS = [[260, 53], [531, 50], [798, 49], [1069, 53], [1331, 57], [1595, 55]];
export const WALL_BOTTOM = 980;

/** The ceiling's lower edge, level across the photo. */
export const WALL_TOP = 80;

export function inLogo(x, y, pad = 0) {
  return x > LOGO_BOX.x0 - pad && x < LOGO_BOX.x1 + pad && y > LOGO_BOX.y0 - pad && y < LOGO_BOX.y1 + pad;
}

/** Whether (x, y) is on HR's head (pad units round it too). */
export function inFace(x, y, pad = 0) {
  return ((x - FACE.cx) / (FACE.rx + pad)) ** 2 + ((y - FACE.cy) / (FACE.ry + pad)) ** 2 < 1;
}

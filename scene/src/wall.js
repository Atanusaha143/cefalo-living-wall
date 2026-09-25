// Everything the scene knows about the photo, in wall units: pixels of the photo
// scaled to 1600 wide, origin top-left, y pointing down.
export const WALL_W = 1600;
export const WALL_H = 1067;
export const LOGO_BOX = { x0: 450, y0: 425, x1: 1145, y1: 578 };
// Printed by `npm run photo` (assets-src/prepare-photo.sh), which levels the ceiling.
export const LIGHTS = [[260, 53], [531, 50], [798, 49], [1069, 53], [1331, 57], [1595, 55]];
export const WALL_BOTTOM = 980;

/** The ceiling's lower edge, level across the photo. */
export const WALL_TOP = 80;

export function inLogo(x, y, pad = 0) {
  return x > LOGO_BOX.x0 - pad && x < LOGO_BOX.x1 + pad && y > LOGO_BOX.y0 - pad && y < LOGO_BOX.y1 + pad;
}

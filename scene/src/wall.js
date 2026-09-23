// Everything the scene knows about the photo, in wall units: pixels of the photo
// scaled to 1600 wide, origin top-left, y pointing down.
export const WALL_W = 1600;
export const WALL_H = 1067;
export const LOGO_BOX = { x0: 450, y0: 425, x1: 1145, y1: 578 };
export const LIGHTS = [[255, 57], [527, 59], [795, 64], [1066, 73], [1330, 82], [1590, 87]];
export const WALL_BOTTOM = 980;

/** The ceiling's lower edge, which slopes from y=82 on the left to y=108 on the right. */
export const wallTop = (x) => 82 + (108 - 82) * (x / WALL_W);

export function inLogo(x, y, pad = 0) {
  return x > LOGO_BOX.x0 - pad && x < LOGO_BOX.x1 + pad && y > LOGO_BOX.y0 - pad && y < LOGO_BOX.y1 + pad;
}

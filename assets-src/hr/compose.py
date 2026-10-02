"""Turn the levelled green wall into HR's: paint out CEFALO with leaves from the same rows, put up
an eye mark and HR IS WATCHING in its place, and have HR peek over the hedge above it.

    python3 assets-src/hr/compose.py <levelled wall.jpg> <scene/assets/wall.jpg>

Needs Pillow and NumPy. The headshot's cut-out (person-mask.png) was made once with macOS Vision
(cutout.swift). Positions are photo px (3840 wide, 2.4 per wall unit) unless they say otherwise;
LOGO_BOX, FACE and EYES in scene/src/wall.js and EYE in scene/src/watcher.js follow from them.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
U = 2.4                                   # photo px per wall unit
FONT = '/System/Library/Fonts/SFNSRounded.ttf'


def blurred(mask, radius):
    return np.asarray(mask.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32) / 255


def shifted(mask, dx, dy):
    return mask.transform(mask.size, Image.AFFINE, (1, 0, -dx, 0, 1, -dy))


def erase_logo(a):
    """Cover CEFALO with the wall from the same rows: the wall's leaves grow in level bands, so a
    patch from left of the logo and one from right of it, joined in the middle, fit in."""
    x0, x1, y0, y1 = 960, 2870, 900, 1510
    mid, seam = (x0 + x1) // 2, 80
    left, right = 40, 2850                # where the patches come from: clear of the logo
    patch = np.concatenate([a[y0:y1, left:left + mid - x0], a[y0:y1, right:right + x1 - mid]], 1)
    for i in range(seam):
        t, c = i / seam, mid - x0 - seam // 2 + i
        patch[:, c] = (1 - t) * a[y0:y1, left + c] + t * a[y0:y1, right - seam // 2 + i]
    mask = Image.new('L', (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(mask).rectangle([30, 30, x1 - x0 - 30, y1 - y0 - 30], fill=255)
    m = blurred(mask, 14)[..., None]
    a[y0:y1, x0:x1] = m * patch + (1 - m) * a[y0:y1, x0:x1]


def put_up_sign(a):
    """The eye mark and HR IS WATCHING, white and standing off the wall like CEFALO's letters
    (bright enough in blue for the scene's letterAt to find them). Returns its box in wall units."""
    H, W, _ = a.shape
    font = ImageFont.truetype(FONT, int(124 * U))
    font.set_variation_by_axes([500])
    text = 'HR IS WATCHING'
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    eye_w, eye_h, gap = 168 * U, 100 * U, 28 * U
    x, cy = (W - (eye_w + gap + r - l)) / 2, 502 * U
    ecx = x + eye_w / 2

    def almond(sx=1, sy=1):
        top = [(u, -(1 - u * u) ** 0.9) for u in np.linspace(-1, 1, 121)]
        return [(ecx + u * eye_w / 2 * sx, cy + v * eye_h / 2 * sy) for u, v in top + [(-u, -v) for u, v in top]]
    d.polygon(almond(), fill=255)
    d.polygon(almond(0.86, 0.62), fill=0)
    pupil = 30 * U
    d.ellipse([ecx - pupil, cy - pupil, ecx + pupil, cy + pupil], fill=255)
    d.text((x + eye_w + gap - l, cy - (t + b) / 2), text, font=font, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    a *= 1 - 0.75 * blurred(shifted(mask, 5 * U, 8 * U), 9 * U)[..., None]   # its shadow on the wall
    rim = blurred(shifted(mask, 1.5 * U, 2.5 * U), 0)[..., None]             # its edge, in shade
    a[:] = a * (1 - rim) + rim * np.array([150, 156, 165])
    m = blurred(mask, 0)[..., None]
    yy = np.arange(H, dtype=np.float32)[:, None, None]
    face = np.array([238, 241, 246]) - np.clip((yy - cy) / (75 * U), -1, 1) * np.array([5, 4, 2])
    a[:] = a * (1 - m) + face * m
    ys, xs = np.nonzero(m[..., 0] > 0.5)
    return [round(v / U) for v in (xs.min(), ys.min(), xs.max(), ys.max())]


def add_hr(a):
    """HR's head over the hedge, his chin at (800, 410) wall units; leaves in front from the neck
    down, following the wall's bright leaves so the edge is ragged; his shadow on the wall."""
    S = 1.05                              # wall units per headshot px
    chin_src, chin_wall = (280, 300), (800, 410)
    person = Image.open(HERE / 'person.png').convert('RGB')
    cut = Image.open(HERE / 'person-mask.png').convert('L').filter(ImageFilter.MinFilter(3))   # no blue fringe
    k = S * U
    size = (round(person.width * k), round(person.height * k))
    P = np.asarray(person.resize(size, Image.LANCZOS)).astype(np.float32)
    A = blurred(cut.resize(size, Image.LANCZOS), 1.5)
    x0, y0 = round((chin_wall[0] - chin_src[0] * S) * U), round((chin_wall[1] - chin_src[1] * S) * U)
    region = a[y0:y0 + size[1], x0:x0 + size[0]]
    rh, rw = region.shape[:2]
    P, A = P[:rh, :rw], A[:rh, :rw]
    P = P * np.array([0.80, 0.84, 0.74]) + np.array([4, 8, 2])        # daylight in a hedge, not a studio
    y = np.arange(rh, dtype=np.float32)[:, None] / k                   # headshot rows
    leafy = np.clip((region[..., 1] - np.maximum(region[..., 0], region[..., 2]) * 0.8) / 70, 0, 1)
    leafy = blurred(Image.fromarray((leafy * 255).astype(np.uint8)), 2)
    front = np.clip((y - 290) / 34 * 2.2 - 0.5 + (leafy - 0.3) * 3.2, 0, 1)
    front = np.where(y > 326, 1.0, front)
    P *= (1 - 0.25 * np.clip((y - 230) / 80, 0, 1))[..., None]         # the hedge shades his lower face
    alpha = (A * (1 - front))[..., None]
    shadow = Image.fromarray((A * (1 - np.clip(front * 1.2, 0, 1)) * 255).astype(np.uint8))
    region *= 1 - 0.55 * blurred(shifted(shadow.filter(ImageFilter.GaussianBlur(14 * U)), 6 * U, 8 * U), 0)[..., None]
    region[:] = region * (1 - alpha) + P * alpha
    wall = lambda sx, sy: (round(chin_wall[0] + (sx - chin_src[0]) * S, 1), round(chin_wall[1] + (sy - chin_src[1]) * S, 1))
    return {'pupils': [wall(239, 152), wall(315, 151)], 'head top': wall(280, 8)}


def main(src, dst):
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    erase_logo(a)
    print('LOGO_BOX', put_up_sign(a))
    print('HR', add_hr(a))
    Image.fromarray(a.clip(0, 255).astype(np.uint8)).save(dst, quality=90, optimize=True, progressive=True)
    print('Wrote', dst)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])

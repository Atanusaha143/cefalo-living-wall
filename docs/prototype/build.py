"""Throwaway preview: builds green-wall-preview.svg from the Cefalo green-wall photo.

Layers (back to front): still photo, photo with a masked wind-sway displacement,
vector leaves (CSS wind + gust, JS cursor spring), butterfly (SMIL), downlight
cones/glows, logo light sweep, dust motes.
"""
import base64, math, random, struct
from pathlib import Path

random.seed(11)
HERE = Path(__file__).parent
W, H = 1600, 1067
LOGO = (450, 425, 1145, 578)            # letters' bounding box
LIGHTS = [(255, 57), (527, 59), (795, 64), (1066, 73), (1330, 82), (1590, 87)]
WALL_TOP = lambda x: 82 + (108 - 82) * x / W   # ceiling edge, slanted
WALL_BOTTOM = 980

# ---------------------------------------------------------------- colour sampling
bmp = (HERE / "sample.bmp").read_bytes()
off = struct.unpack("<I", bmp[10:14])[0]
bw, bh = struct.unpack("<ii", bmp[18:26])
row = (bw * 3 + 3) // 4 * 4
top_down = bh < 0
bh = abs(bh)

def px(x, y):
    x = min(bw - 1, max(0, x)); y = min(bh - 1, max(0, y))
    r_ = y if top_down else bh - 1 - y
    i = off + r_ * row + x * 3
    b, g, r = bmp[i], bmp[i + 1], bmp[i + 2]
    return r, g, b

def leaf_colour(x, y, dim=1.0):
    """Bright-ish leaf colour near (x, y): 80th percentile by luminance of a 7x7 patch."""
    sx, sy = int(x * bw / W), int(y * bh / H)
    patch = [px(sx + i, sy + j) for i in range(-3, 4) for j in range(-3, 4)]
    patch.sort(key=lambda c: 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2])
    r, g, b = patch[int(len(patch) * 0.68)]
    # keep it foliage: no near-white (logo/pebbles), no near-black
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    if b > 150 or lum < 38:
        r, g, b = 52, 92, 36
    k = random.uniform(0.9, 1.1) * dim
    return "#%02x%02x%02x" % tuple(min(255, int(c * k)) for c in (r, g, b))

# ---------------------------------------------------------------- leaf placement
def in_logo(x, y, pad):
    return LOGO[0] - pad < x < LOGO[2] + pad and LOGO[1] - pad < y < LOGO[3] + pad

LEAF_LEN = 44
SHAPES = ["heart", "lance", "ovate"]
leaves, stems = [], []
row_y = 128
while row_y < WALL_BOTTOM - 12:
    x = random.uniform(-30, 20)
    while x < W + 30:
        x += random.uniform(52, 96)
        px_, py_ = x + random.uniform(-10, 10), row_y + random.uniform(-9, 9)
        if random.random() < 0.45 or in_logo(px_, py_, 30) or py_ < WALL_TOP(px_) + 30:
            continue
        for _ in range(random.choice([1, 1, 2, 2, 3])):
            theta = random.gauss(0, 34)
            if random.random() < 0.15:
                theta = random.choice([-1, 1]) * random.uniform(95, 140)
            if py_ < WALL_TOP(px_) + 70:
                theta = math.copysign(random.uniform(75, 140), theta or 1)
            t = math.radians(theta)
            stem = random.uniform(5, 16)
            bx, by = px_ + math.sin(t) * stem, py_ - math.cos(t) * stem
            s_ = random.uniform(0.55, 1.05)
            sx = random.uniform(0.5, 1.0)          # foreshortened: seen at an angle
            tip = (bx + math.sin(t) * LEAF_LEN * s_, by - math.cos(t) * LEAF_LEN * s_)
            mid = (bx + math.sin(t) * LEAF_LEN * s_ * 0.55, by - math.cos(t) * LEAF_LEN * s_ * 0.55)
            if in_logo(*tip, 12) or in_logo(*mid, 12) or tip[1] < WALL_TOP(tip[0]) + 6 or tip[1] > WALL_BOTTOM + 6:
                continue
            far = random.random() < 0.3             # a few smaller, darker, "deeper" leaves
            leaves.append(dict(x=bx, y=by, theta=theta, s=s_ * (0.8 if far else 1), sx=sx, mid=mid,
                               shape=random.choice(SHAPES), far=far,
                               colour=leaf_colour(*mid, dim=0.78 if far else 1.0)))
            cx_, cy_ = (px_ + bx) / 2 + random.uniform(-3, 3), (py_ + by) / 2 + random.uniform(-3, 3)
            stems.append(f'M{px_:.1f},{py_:.1f} Q{cx_:.1f},{cy_:.1f} {bx:.1f},{by:.1f}')
    row_y += random.uniform(46, 58)
leaves.sort(key=lambda l: (not l["far"], l["y"]))   # deep leaves first, then lower rows over upper

def leaf_svg(l):
    t = math.radians(l["theta"])
    ux, uy = math.cos(t), math.sin(t)            # world direction a clockwise bend moves the tip
    sym = l["shape"] + ("L" if math.sin(t) > 0 else "R")  # keep the lit side facing up
    sway = random.uniform(2.2, 4.8) * (1 if random.random() < 0.5 else -1)
    phase = -((1 - l["x"] / W) * 2.6 + random.uniform(0, 0.7))
    gust = 13 * math.cos(t) * random.uniform(0.7, 1.2)
    gdelay = l["x"] / W * 2.4 + l["y"] / H * 0.35 + random.uniform(0, 0.2)
    return (
        f'<g transform="translate({l["x"]:.1f} {l["y"]:.1f}) rotate({l["theta"]:.1f}) scale({l["s"] * l["sx"]:.2f} {l["s"]:.2f})">'
        f'<g class="sway" style="--a:{sway:.2f}deg;animation-delay:{phase:.2f}s">'
        f'<g class="gust" style="--g:{gust:.2f}deg;animation-delay:{gdelay:.2f}s">'
        f'<g class="bend" data-x="{l["x"]:.1f}" data-y="{l["y"]:.1f}" data-cx="{l["mid"][0]:.1f}" '
        f'data-cy="{l["mid"][1]:.1f}" data-ux="{ux:.3f}" data-uy="{uy:.3f}">'
        f'<use href="#{sym}" fill="{l["colour"]}"/></g></g></g></g>'
    )

# ---------------------------------------------------------------- butterfly flight
def catmull(pts, steps=26):
    out = []
    p = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(steps):
            u = k / steps
            out.append(tuple(
                0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * u + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * u * u
                       + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * u ** 3) for d in (0, 1)))
    out.append(pts[-1])
    return out

def flutter(pts, amp=5.5, wl=38):
    """Add a perpendicular zig-zag so it flies like a butterfly, not a drone."""
    out, dist = [pts[0]], 0
    for a, b in zip(pts, pts[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        seg = math.hypot(dx, dy) or 1
        dist += seg
        nx, ny = -dy / seg, dx / seg
        w = amp * math.sin(dist / wl * 2 * math.pi) + 2.5 * math.sin(dist / 11)
        out.append((b[0] + nx * w, b[1] + ny * w))
    return out

land_a = min(leaves, key=lambda l: (l["mid"][0] - 1290) ** 2 + (l["mid"][1] - 300) ** 2)["mid"]
land_b = min(leaves, key=lambda l: (l["mid"][0] - 330) ** 2 + (l["mid"][1] - 720) ** 2)["mid"]
leg1 = flutter(catmull([(1700, 170), (1520, 260), (1430, 180), (1340, 250), land_a]))
leg2 = flutter(catmull([land_a, (1180, 360), (1060, 250), (820, 330), (640, 640), (520, 820), (420, 690), land_b]))
leg3 = flutter(catmull([land_b, (250, 600), (160, 470), (40, 420), (-120, 330)]))
path_pts = leg1 + leg2[1:] + leg3[1:]
lens = [0.0]
for a, b in zip(path_pts, path_pts[1:]):
    lens.append(lens[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
total = lens[-1]
fa = lens[len(leg1) - 1] / total
fb = lens[len(leg1) + len(leg2) - 2] / total
DUR = 38.0
#   off-screen | fly in | rest | fly across | rest | fly out | off-screen
T = [0, 1.5, 7.5, 13.5, 23.5, 29.5, 34.0, DUR]
key_times = ";".join(f"{t / DUR:.4f}" for t in T)
key_points = ";".join(f"{v:.4f}" for v in [0, 0, fa, fa, fb, fb, 1, 1])
flight_d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in path_pts)

def flap_values():
    """Wing scale over one cycle: fast flaps in flight, slow open/close while resting."""
    frames = []                                    # (time, open-ness)
    resting = [(T[2], T[3]), (T[4], T[5])]
    t = 0.0
    while t < DUR:
        rest = next(((a, b) for a, b in resting if a <= t < b), None)
        if rest:
            frames += [(t, 1.0), (t + 1.3, 1.0), (t + 1.7, 0.45), (t + 2.1, 1.0)]
            t += 2.1
            if t > rest[1]:
                t = rest[1]
        else:
            frames += [(t, 1.0), (t + 0.11, 0.18)]
            t += 0.22
    frames = [(min(tt, DUR), v) for tt, v in frames]
    frames.append((DUR, 1.0))
    cleaned, last_t = [], -1
    for tt, v in frames:
        if tt > last_t:
            cleaned.append((tt, v)); last_t = tt
    cleaned[0] = (0.0, cleaned[0][1])
    return (";".join(f"{tt / DUR:.5f}" for tt, _ in cleaned),
            ";".join(f"1 {v:.2f}" for _, v in cleaned))

flap_kt, flap_vals = flap_values()

# ---------------------------------------------------------------- dust motes in the light
motes = []
for lx, ly in LIGHTS:
    for _ in range(3):
        mx = lx + random.uniform(-60, 60)
        my = ly + random.uniform(40, 200)
        motes.append(
            f'<circle class="mote" cx="{mx:.0f}" cy="{my:.0f}" r="{random.uniform(0.9, 1.9):.1f}" '
            f'style="animation-duration:{random.uniform(9, 16):.1f}s;animation-delay:{-random.uniform(0, 16):.1f}s;'
            f'--dx:{random.uniform(-25, 25):.0f}px"/>')

# ---------------------------------------------------------------- leaf symbols
BLADES = {
    "heart": "M0,-8 C-4,-5 -11,-8 -11.5,-17 C-12,-27 -5,-34 0,-44 C5,-34 12,-27 11.5,-17 C11,-8 4,-5 0,-8 Z",
    "lance": "M0,-6 C-4,-8 -7,-16 -7,-24 C-7,-33 -3,-39 0.5,-46 C3,-39 7,-33 7,-24 C7,-16 4,-8 0,-6 Z",
    "ovate": "M0,-6 C-7,-6 -12.5,-13 -12.5,-21 C-12.5,-30 -6,-36 0,-41 C6,-36 12.5,-30 12.5,-21 C12.5,-13 7,-6 0,-6 Z",
}
def leaf_defs():
    out = []
    for name, d in BLADES.items():
        out.append(f'  <path id="b-{name}" d="{d}"/>')
        for side, sign in (("L", 1), ("R", -1)):
            out.append(f'''  <symbol id="{name}{side}" overflow="visible">
    <path d="M0,1 L0,-7" stroke="#223d18" stroke-width="1.5" stroke-linecap="round"/>
    <use href="#b-{name}" transform="translate(2 3)" fill="#000" opacity=".3"/>
    <use href="#b-{name}" stroke="#0a1606" stroke-opacity=".22" stroke-width=".6"/>
    <use href="#b-{name}" fill="url(#shade{side})"/>
    <path d="M0,-7 Q{sign * 1.2},-24 0,-40" fill="none" stroke="#eaffc8" stroke-opacity=".2" stroke-width=".7"/>
    <ellipse cx="{-sign * 4}" cy="-23" rx="2" ry="6.5" fill="#fff" opacity=".08" transform="rotate({sign * 12} {-sign * 4} -23)"/>
  </symbol>''')
    return "\n".join(out)
LEAF_DEFS = leaf_defs()

# ---------------------------------------------------------------- assemble
photo = "data:image/jpeg;base64," + base64.b64encode((HERE / "wall-q62.jpg").read_bytes()).decode()
lx0, ly0, lx1, ly1 = LOGO

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
<title>Green wall — live wallpaper preview</title>
<style>
  :root {{ background: #050805; }}
  .sway {{ animation: sway 5s ease-in-out infinite; }}
  .gust {{ animation: gust 17s ease-in-out infinite both; }}
  @keyframes sway {{ 0%,100% {{ transform: rotate(calc(var(--a) * -1)); }} 50% {{ transform: rotate(var(--a)); }} }}
  @keyframes gust {{
    0%, 58%, 100% {{ transform: rotate(0deg); }}
    66% {{ transform: rotate(var(--g)); }}
    74% {{ transform: rotate(calc(var(--g) * -0.45)); }}
    82% {{ transform: rotate(calc(var(--g) * 0.2)); }}
    90% {{ transform: rotate(calc(var(--g) * -0.05)); }}
  }}
  .mote {{ fill: #fff1d6; animation: drift 12s linear infinite; }}
  @keyframes drift {{
    0% {{ transform: translate(0, -20px); opacity: 0; }}
    20% {{ opacity: .75; }} 80% {{ opacity: .6; }}
    100% {{ transform: translate(var(--dx), 90px); opacity: 0; }}
  }}
  .hint {{ font: 500 15px -apple-system, system-ui, sans-serif; fill: #fff; letter-spacing: .02em;
          animation: hint 9s ease forwards; }}
  @keyframes hint {{ 0%, 60% {{ opacity: .8; }} 100% {{ opacity: 0; }} }}
  @media (prefers-reduced-motion: reduce) {{ .sway, .gust, .mote {{ animation: none; }} }}
</style>
<defs>
  <image id="photo" href="{photo}" width="{W}" height="{H}" preserveAspectRatio="none"/>

  <!-- wind shimmer for the photographed leaves: a noise field that drifts back and forth -->
  <filter id="sway" filterUnits="userSpaceOnUse" x="-260" y="-40" width="{W + 520}" height="{H + 80}">
    <feTurbulence type="fractalNoise" baseFrequency="0.017 0.042" numOctaves="2" seed="4" result="noise"/>
    <feOffset in="noise" dx="0" result="moved">
      <animate attributeName="dx" values="0;200;0" keyTimes="0;0.5;1" dur="24s" repeatCount="indefinite"
               calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>
    </feOffset>
    <feDisplacementMap in="SourceGraphic" in2="moved" scale="7" xChannelSelector="R" yChannelSelector="G">
      <animate attributeName="scale" values="5;10;6;9;5" dur="13s" repeatCount="indefinite"/>
    </feDisplacementMap>
  </filter>
  <!-- white logo pixels (high blue) -> opaque black, grown a little so no white smears -->
  <filter id="logoCut" filterUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 12 0 -8.6"/>
    <feMorphology operator="dilate" radius="7"/>
    <feGaussianBlur stdDeviation="2"/>
  </filter>
  <filter id="logoWhite" filterUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
    <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 12 0 -8.6"/>
    <feMorphology operator="erode" radius="1"/>
  </filter>
  <filter id="feather" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="5"/></filter>
  <clipPath id="logoBox"><rect x="{lx0 - 20}" y="{ly0 - 20}" width="{lx1 - lx0 + 40}" height="{ly1 - ly0 + 40}"/></clipPath>

  <mask id="wallMask" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
    <polygon points="0,{WALL_TOP(0) + 4:.0f} {W / 2:.0f},{WALL_TOP(W / 2) + 4:.0f} {W},{WALL_TOP(W) + 4:.0f} {W},{WALL_BOTTOM} 0,{WALL_BOTTOM}"
             fill="#fff" filter="url(#feather)"/>
    <g clip-path="url(#logoBox)"><use href="#photo" filter="url(#logoCut)"/></g>
  </mask>
  <filter id="logoGlow" filterUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
    <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 12 0 -8.6"/>
    <feMorphology operator="dilate" radius="3"/>
    <feGaussianBlur stdDeviation="9"/>
  </filter>
  <mask id="logoHalo" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
    <g clip-path="url(#haloBox)"><use href="#photo" filter="url(#logoGlow)"/></g>
  </mask>
  <clipPath id="haloBox"><rect x="{lx0 - 50}" y="{ly0 - 50}" width="{lx1 - lx0 + 100}" height="{ly1 - ly0 + 100}"/></clipPath>
  <mask id="logoOnly" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
    <g clip-path="url(#logoBox)"><use href="#photo" filter="url(#logoWhite)"/></g>
  </mask>

  <!-- pothos leaf, stem base at the origin, pointing up -->
  <linearGradient id="shadeL" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity=".13"/><stop offset=".48" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".52" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/>
  </linearGradient>
  <linearGradient id="shadeR" href="#shadeL" x1="1" x2="0"/>
{LEAF_DEFS}

  <!-- butterfly, head toward +x; the wing group folds by scaling y -->
  <radialGradient id="wing" cx=".35" cy=".4" r=".8">
    <stop offset="0" stop-color="#ffb347"/><stop offset=".65" stop-color="#f07a1a"/><stop offset="1" stop-color="#b8480c"/>
  </radialGradient>
  <g id="wings">
    <animateTransform attributeName="transform" type="scale" dur="{DUR}s" repeatCount="indefinite"
                      calcMode="linear" keyTimes="{flap_kt}" values="{flap_vals}"/>
    <g id="wingPair" stroke="#241208" stroke-width="1.1" stroke-linejoin="round">
      <path d="M-1,-1 C-3,-6 -6,-11 -9.5,-11.5 C-12.5,-11 -11.5,-5.5 -7.5,-2.5 C-5,-1 -3,-0.6 -1,-1 Z" fill="url(#wing)"/>
      <path d="M1,-1 C3,-9 7,-15 7.5,-18.5 C3,-19.5 -3.5,-15.5 -4.5,-10.5 C-4.5,-6 -2.5,-3 -1,-1 Z" fill="url(#wing)"/>
      <circle cx="6.2" cy="-17.2" r=".8" fill="#fff" stroke="none"/><circle cx="3.9" cy="-17.6" r=".6" fill="#fff" stroke="none"/>
    </g>
    <use href="#wingPair" transform="scale(1 -1)"/>
  </g>
  <filter id="toShadow"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .38 0"/></filter>

  <radialGradient id="glow">
    <stop offset="0" stop-color="#fff6e4" stop-opacity=".95"/><stop offset=".25" stop-color="#ffd9a0" stop-opacity=".45"/>
    <stop offset="1" stop-color="#ffb870" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="cone" cx=".5" cy=".5" r=".5" fx=".5" fy=".06">
    <stop offset="0" stop-color="#ffe2b0" stop-opacity=".34"/><stop offset=".5" stop-color="#ffcf90" stop-opacity=".12"/>
    <stop offset="1" stop-color="#ffc080" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="spill" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff4dc" stop-opacity="0"/><stop offset=".5" stop-color="#fff0d0" stop-opacity=".75"/>
    <stop offset="1" stop-color="#fff4dc" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="vignette" cx=".5" cy=".5" r=".75">
    <stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/>
  </radialGradient>
</defs>

<!-- 1. the photo, still -->
<use href="#photo"/>
<!-- 2. the photographed leaves, swaying (ceiling, pebbles and logo masked out) -->
<use href="#photo" filter="url(#sway)" mask="url(#wallMask)"/>

<!-- 3. front layer of real leaves -->
<path d="{' '.join(stems)}" fill="none" stroke="#2a4a1c" stroke-width="1.3" stroke-linecap="round" opacity=".85"/>
<g id="leaves">
{chr(10).join(leaf_svg(l) for l in leaves)}
</g>

<!-- 4. butterfly visitor -->
<g>
  <animateMotion dur="{DUR}s" repeatCount="indefinite" rotate="auto" calcMode="linear"
                 keyTimes="{key_times}" keyPoints="{key_points}" path="{flight_d}"/>
  <use href="#wings" transform="translate(3 5)" filter="url(#toShadow)"/>
  <use href="#wings"/>
  <ellipse cx="0" cy="0" rx="6.5" ry="1.5" fill="#241208"/>
  <circle cx="6.6" cy="0" r="1.6" fill="#241208"/>
  <path d="M7.5,-.6 Q10,-2 12,-4.2 M7.5,.6 Q10,2 12,4.2" stroke="#241208" stroke-width=".6" fill="none"/>
</g>

<!-- 5. downlights: warm cones washing the top of the wall, and the fixtures' glow -->
<g style="mix-blend-mode:screen">
{chr(10).join(f'  <ellipse cx="{x}" cy="{y + 200}" rx="130" ry="215" fill="url(#cone)"/>' for x, y in LIGHTS)}
{chr(10).join(f'  <circle cx="{x}" cy="{y}" r="30" fill="url(#glow)"/>' for x, y in LIGHTS)}
</g>
<g>{"".join(motes)}</g>

<!-- 6. logo: a slow light passes along the letters, haloing the leaves around them -->
<g style="mix-blend-mode:screen">
  <g mask="url(#logoHalo)">
    <rect x="{lx0 - 330}" y="{ly0 - 80}" width="240" height="{ly1 - ly0 + 160}" fill="url(#spill)" transform="skewX(-22)">
      <animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 0;{lx1 - lx0 + 640} 0"
                        keyTimes="0;0.7;1" dur="11s" repeatCount="indefinite"/>
    </rect>
  </g>
</g>
<g mask="url(#logoOnly)">
  <rect x="{lx0 - 280}" y="{ly0 - 60}" width="150" height="{ly1 - ly0 + 120}" fill="url(#sweep)" transform="skewX(-22)">
    <animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;0 0;{lx1 - lx0 + 620} 0"
                      keyTimes="0;0.7;1" dur="11s" repeatCount="indefinite"/>
  </rect>
</g>

<rect width="{W}" height="{H}" fill="url(#vignette)" pointer-events="none"/>
<text class="hint" x="{W / 2}" y="{H - 22}" text-anchor="middle">Move your cursor across the leaves</text>

<script><![CDATA[
(() => {{
  const svg = document.documentElement, pt = svg.createSVGPoint();
  const leaves = [...document.querySelectorAll('g.bend')].map(el => {{
    const d = el.dataset;
    return {{ el, x: +d.x, y: +d.y, cx: +d.cx, cy: +d.cy, ux: +d.ux, uy: +d.uy, a: 0, v: 0, live: false }};
  }});
  let px = -1e5, py = -1e5, vx = 0, vy = 0;
  const R = 90, MAX = 38;
  addEventListener('pointermove', e => {{
    const m = svg.getScreenCTM(); if (!m) return;
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    if (px > -1e4) {{ vx = p.x - px; vy = p.y - py; }}
    px = p.x; py = p.y;
  }});
  document.addEventListener('pointerleave', () => {{ px = py = -1e5; }});
  svg.addEventListener('mouseleave', () => {{ px = py = -1e5; }});
  const seek = /[#&]t=([\\d.]+)/.exec(location.hash);
  if (seek) {{
    const t = +seek[1];
    svg.pauseAnimations(); svg.setCurrentTime(t);
    document.getAnimations().forEach(a => {{ a.pause(); a.currentTime = t * 1000; }});
    return;
  }}
  (function frame() {{
    for (const l of leaves) {{
      const dx = l.cx - px, dy = l.cy - py, d2 = dx * dx + dy * dy;
      let target = 0;
      if (d2 < R * R) {{
        const f = 1 - Math.sqrt(d2) / R;
        const side = (px - l.x) * l.ux + (py - l.y) * l.uy;   // which side of the leaf the cursor is on
        target = (side > 0 ? -1 : 1) * MAX * f * f;              // bend away from it
        l.v += (vx * l.ux + vy * l.uy) * 0.22 * f;               // brushing past gives it a flick
      }}
      l.v += (target - l.a) * 0.08;                               // spring back...
      l.v *= 0.87;                                                // ...with a little overshoot
      l.a = Math.max(-55, Math.min(55, l.a + l.v));
      if (target || Math.abs(l.a) > 0.04 || Math.abs(l.v) > 0.04) {{
        l.el.setAttribute('transform', `rotate(${{l.a.toFixed(2)}})`); l.live = true;
      }} else if (l.live) {{
        l.el.removeAttribute('transform'); l.a = l.v = 0; l.live = false;
      }}
    }}
    vx *= 0.6; vy *= 0.6;
    requestAnimationFrame(frame);
  }})();
}})();
]]></script>
</svg>
'''
out = HERE / "green-wall-preview.svg"
out.write_text(svg)
print(f"{out}  {out.stat().st_size / 1024:.0f} KB, {len(leaves)} leaves, flight path {total:.0f}px")

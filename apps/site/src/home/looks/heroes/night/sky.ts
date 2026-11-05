import { AT } from '../../../hero/journey'

/*
 * Prototype, the Night first screen: the re-entry seen from orbit, drawn on
 * the graphics card. A camera high over the night side looks out at the
 * planet's edge: black space and its stars over the dark curve, towns in gold
 * under faint cloud, the thin cobalt line of the air along the edge. That
 * much never changes, so it is drawn once, into a picture the size of the
 * canvas (the scene), and drawn again only when the size does.
 *
 * Every frame of the journey lays the capsule's fire over it (the frame):
 * a point of light low over the edge that catches, brightens and lengthens
 * as it runs along it; every point of its trail was laid down at a second of
 * the journey, as hot as the capsule was then, and cools and spreads from
 * then on, so the trail is read off the clock whole. At its height it
 * breaks: a flash, pieces thrown on and going out, and the trail left to
 * cool to a faint ember wisp. Then the faintest dawn at the edge's far end.
 */

const DEG = Math.PI / 180

/** The planet and the camera's height over it, in km. */
const RP = 6360
const HC = 1100
/** How far below the horizontal the planet's edge stands from the camera. */
const EDGE_DIP = Math.acos(RP / (RP + HC))

/** Where the capsule's fire runs, as the screen's width has it: where it catches, and how far it runs a second. */
export interface Path {
  /** Where it catches, across the frame, 0 to 1. */
  from: number
  /** How far it runs in a second, in the frame's widths. */
  speed: number
  /** How far under the edge's line it runs, in CSS px, at the frame's left and right. */
  under: [number, number]
}

export interface Framing {
  /** The canvas's size in CSS px, and its px per CSS px. */
  width: number
  height: number
  dpr: number
  /** Where the edge's crest stands, from the top, 0 to 1. */
  edge: number
  /** The camera's height of view, in degrees. */
  fov: number
  path: Path
}

export interface Frame {
  /** The journey's second. */
  t: number
  /** How far the dawn has come up at the edge's far end, 0 to 1. */
  dawn: number
}

export interface Sky {
  place: (framing: Framing) => void
  draw: (frame: Frame) => void
  /** Lets the scene's picture go: the canvas keeps its last frame. */
  rest: () => void
  dispose: () => void
}

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

/** What both passes share: the camera, the planet, noise. */
const COMMON = `#version 300 es
precision highp float;
out vec4 color;

uniform vec2 uRes;
uniform float uFocal;
uniform float uPitch;
uniform float uDpr;

const float RP = ${RP.toFixed(1)};
const float HC = ${HC.toFixed(1)};
const float SIN_DIP = ${Math.sin(EDGE_DIP).toFixed(6)};

vec2 sphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1, 0, 0)), c = hash13(i + vec3(0, 1, 0)), d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1)), g = hash13(i + vec3(1, 0, 1)), k = hash13(i + vec3(0, 1, 1)), l = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(k, l, f.x), f.y), f.z);
}

// The camera: its ray through a pixel, and the planet's edge as it sees it.
vec3 ray(vec2 frag) {
  vec2 uv = (frag - 0.5 * uRes) / uFocal;
  float sp = sin(uPitch), cp = cos(uPitch);
  return normalize(vec3(0.0, sp, cp) + uv.x * vec3(1.0, 0.0, 0.0) + uv.y * vec3(0.0, cp, -sp));
}
// The edge's height on the screen at a horizontal place, both in focal lengths from the middle: where a ray grazes the planet.
float edgeAt(float ux) {
  float sp = sin(uPitch), cp = cos(uPitch);
  float s2 = SIN_DIP * SIN_DIP;
  float a = cp * cp - s2;
  float b = 2.0 * sp * cp;
  float c = sp * sp - s2 * (1.0 + ux * ux);
  float d = sqrt(max(b * b - 4.0 * a * c, 0.0));
  float y1 = (-b - d) / (2.0 * a);
  float y2 = (-b + d) / (2.0 * a);
  // The one looking down at the planet, not its mirror over the horizontal.
  return sp + y2 * cp < 0.0 ? y2 : y1;
}
`

/** The scene: drawn once for a size. */
const SCENE = `${COMMON}
uniform float uTurn;

// An fbm whose finer octaves give way to their mean where a pixel covers more than they can show: \`foot\` is a pixel's size at frequency 1.
float fbm(vec3 p, int octaves, float foot) {
  float sum = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    float keep = clamp(1.6 - foot * freq * 2.2, 0.0, 1.0);
    sum += amp * mix(0.5, noise(p * freq), keep);
    freq *= 2.03;
    amp *= 0.5;
    p += vec3(17.1, 3.7, 9.2);
  }
  return sum / (1.0 - pow(0.5, float(octaves)));
}

// One layer of towns: a light in some cells of a grid on the planet, each a soft point, widened (and dimmed to keep its light) where a pixel is larger than it.
float towns(vec3 n, float freq, float keep, float foot, float urban) {
  vec3 c = n * freq;
  vec3 cell = floor(c);
  vec3 h = hash33(cell);
  float lit = clamp((keep * urban - h.z) / 0.12, 0.0, 1.0);
  if (lit <= 0.0) return 0.0;
  vec3 at = cell + 0.3 + 0.4 * hash33(cell + 7.0);
  float d2 = dot(c - at, c - at);
  float r = 0.07 + 0.09 * h.x;
  float px = foot * freq;
  float s2 = r * r + px * px * 0.6;
  return lit * (0.22 + 2.4 * pow(h.y, 4.0)) * (r * r / s2) * exp(-d2 / s2);
}
// The towns, by how near the ground is (1 near, 0 at the edge): near, more of them and gold; far, fewer, and reddened by the air.
vec3 night(vec3 n, float foot, float near, out float cloud) {
  vec3 q = n * 2.1;
  float land = smoothstep(0.43, 0.51, fbm(q + 4.0, 5, foot * 2.1));
  float urban = land * smoothstep(0.38, 0.64, fbm(n * 11.0 + 1.3, 4, foot * 11.0));
  urban *= 0.45 + 0.55 * smoothstep(0.35, 0.7, fbm(n * 34.0 + 5.1, 3, foot * 34.0));
  float lights = 0.0;
  float many = mix(0.5, 1.6, near);
  lights += towns(n, 260.0, 1.6 * many, foot, urban) * 2.8;
  lights += towns(n, 620.0, 1.6 * many, foot, urban) * 1.3;
  lights += towns(n, 1400.0, 1.4 * many, foot, urban) * 0.7;
  float sprawl = urban * urban * smoothstep(0.5, 0.85, fbm(n * 90.0, 3, foot * 90.0));
  lights += sprawl * 0.6 + urban * urban * 0.09;
  cloud = smoothstep(0.5, 0.8, fbm(n * 5.5 + vec3(2.0, 9.0, 4.0), 5, foot * 5.5));
  vec3 gold = mix(vec3(1.0, 0.6, 0.26), vec3(1.0, 0.82, 0.56), hash13(floor(n * 260.0)) * near);
  vec3 sodium = mix(vec3(1.0, 0.4, 0.14), gold, smoothstep(0.0, 0.7, near));
  return sodium * lights * (1.0 - 0.85 * cloud);
}

// The stars, by the face of a cube round the camera, so each star is whole within its cell; \`px\` is the focal length in px.
vec3 starLayer(vec3 d, float scale, float keep, float bright, float salt, float px) {
  vec3 a = abs(d);
  vec2 uv;
  float face;
  if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = sign(d.x); }
  else if (a.y >= a.z) { uv = d.xz / a.y; face = 2.0 * sign(d.y); }
  else { uv = d.xy / a.z; face = 3.0 * sign(d.z); }
  vec2 c = uv * scale;
  vec2 cell = floor(c);
  vec3 h = hash33(vec3(cell, face * 13.0 + salt));
  if (h.z > keep) return vec3(0.0);
  vec2 at = cell + 0.3 + 0.4 * h.xy;
  float dist = length(c - at) / scale * px;
  float m = bright * (0.035 + pow(hash13(vec3(cell, face + salt + 3.0)), 5.0) * 1.4);
  float tint = hash13(vec3(cell, face + salt + 9.0));
  vec3 col = tint < 0.14 ? vec3(0.75, 0.85, 1.0) : tint > 0.9 ? vec3(1.0, 0.86, 0.7) : vec3(1.0);
  // A star is a little more than a px across, however finely it is drawn.
  float r = 0.55 * uDpr;
  return col * m * exp(-dist * dist / (r * r));
}
vec3 stars(vec3 d, float px) {
  // The galaxy's band, faint, across the sky.
  vec3 gn = normalize(vec3(0.5, 0.62, -0.6));
  float band = exp(-pow(dot(d, gn) / 0.22, 2.0));
  float dust = fbm(d * 6.0, 4, 0.0);
  vec3 glow = vec3(0.85, 0.86, 1.0) * band * smoothstep(0.35, 0.8, dust) * 0.0035;
  vec3 s = starLayer(d, 20.0, 0.32, 1.0, 0.0, px);
  s += starLayer(d, 52.0, 0.16, 0.5, 5.0, px);
  s += starLayer(d, 130.0, 0.08 + 0.3 * band * smoothstep(0.4, 0.7, dust), 0.32, 11.0, px);
  return s + glow;
}

vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main() {
  vec3 rd = ray(gl_FragCoord.xy);
  vec3 ro = vec3(0.0, RP + HC, 0.0);
  float px = 1.0 / uFocal;
  vec2 hit = sphere(ro, rd, RP);
  float tc = -dot(ro, rd);
  // How high over the planet the ray passes (below its edge, how far inside it), in km.
  float over = length(ro + rd * max(tc, 0.0)) - RP;
  // Space, a breath warmer than black, as the night pages have it.
  vec3 col = vec3(0.0016, 0.0012, 0.001);
  if (hit.x > 0.0) {
    vec3 p = ro + rd * hit.x;
    vec3 n = p / RP;
    float ca = cos(uTurn), sa = sin(uTurn);
    vec3 m = vec3(ca * n.x - sa * n.y, sa * n.x + ca * n.y, n.z);
    float slant = max(dot(n, -rd), 0.03);
    float foot = hit.x * px / RP / sqrt(slant);
    float horizon = sqrt((RP + HC) * (RP + HC) - RP * RP);
    float near = 1.0 - smoothstep(HC * 1.15, horizon * 0.95, hit.x);
    float cloud;
    vec3 lights = night(m, foot, near, cloud);
    // The longer the way through the air, the dimmer and redder.
    vec3 trans = exp(-vec3(0.025, 0.06, 0.14) / slant);
    col = vec3(0.0009, 0.0008, 0.0008) + lights * mix(0.1, 0.3, near) * trans;
    // The cloud, faint under the moon.
    col += vec3(0.55, 0.62, 0.8) * cloud * 0.003 * (0.35 + 0.65 * trans.g);
    // The air's own faint glow, just inside the edge.
    col += vec3(0.25, 0.32, 1.0) * 0.004 * exp(-max(-over, 0.0) / 30.0);
  } else {
    // Stars, put out by the air low over the edge.
    col += stars(rd, uFocal) * smoothstep(10.0, 90.0, over);
  }

  // The edge lit cobalt, the night's one light: a fine bright line hugging the edge, its glow, and a wide faint haze over it.
  {
    float line = exp(-pow((over - 2.5) / 2.2, 2.0));
    float halo = exp(-max(over, 0.0) / 14.0) * smoothstep(-5.0, 1.0, over);
    float haze = exp(-max(over, 0.0) / 110.0) * smoothstep(-2.0, 3.0, over);
    col += vec3(0.62, 0.66, 1.0) * line * 0.2 + vec3(0.13, 0.18, 1.0) * halo * 0.06 + vec3(0.06, 0.08, 1.0) * haze * 0.016;
  }

  col *= 2.4;
  vec3 mapped = aces(col);
  float lum = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  mapped = mix(mapped, mapped * vec3(1.035, 1.0, 0.94), smoothstep(0.45, 1.0, lum));
  vec3 srgb = pow(mapped, vec3(1.0 / 2.2));
  // Dither, so the dark gradients never band.
  srgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  color = vec4(srgb, 1.0);
}`

/** The frame: the scene, and over it the fire and the dawn, by the journey's second. */
const FRAME = `${COMMON}
uniform sampler2D uScene;
uniform float uT;
uniform float uDawn;
// The fire's way: where it catches (0 to 1 across), how far it runs a second (in widths), how far under the edge it runs at the left and the right (CSS px).
uniform vec4 uPath;
// The sun, under the edge's far end.
uniform vec3 uSun;

const float IGNITE = ${AT.ignite.toFixed(3)};
const float PEAK = ${AT.peak.toFixed(3)};
const float BREAK = ${AT.break.toFixed(3)};
const float BROKEN = ${AT.broken.toFixed(3)};

// journey.ts's heat, as the shader reads it.
float heatAt(float t) {
  float building = clamp((t - IGNITE) / (PEAK - IGNITE), 0.0, 1.0);
  float lit = t < IGNITE ? smoothstep(0.0, IGNITE, t) : 1.0;
  return (0.06 + 0.94 * pow(building, 1.7)) * lit * (1.0 - smoothstep(BREAK, BROKEN, t));
}

// The fire's way across the screen, in device px from the bottom left: at a place across, 0 to 1.
float wayY(float x) {
  float ux = (x - 0.5) * uRes.x / uFocal;
  float under = mix(uPath.z, uPath.w, x) * uDpr;
  return 0.5 * uRes.y + edgeAt(ux) * uFocal - under;
}
// Where the capsule is at second t, 0 to 1 across.
float placeAt(float t) { return uPath.x + uPath.y * (t - IGNITE); }

// A point of light: its core and its glow, by the distance in CSS px.
float blob(float d, float r) { return exp(-d * d / (r * r)); }

void main() {
  vec3 scene = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 light = vec3(0.0);
  vec2 frag = gl_FragCoord.xy;
  float x = frag.x / uRes.x;
  // CSS px from here to the fire's way, straight up or down; good enough, the way is gentle.
  float wy = wayY(x);
  float slope = (wayY(x + 0.002) - wayY(x - 0.002)) / (0.004 * uRes.x);
  float dy = (frag.y - wy) / uDpr / sqrt(1.0 + slope * slope);
  float xs = frag.x / uDpr;
  float v = uPath.y * uRes.x / uDpr;

  vec3 white = vec3(1.0, 0.9, 0.78);
  vec3 orange = vec3(1.0, 0.42, 0.12);
  vec3 red = vec3(0.8, 0.13, 0.04);
  vec3 ember = vec3(0.5, 0.17, 0.12);

  // The trail: this place was passed at second tau, and has cooled and spread since.
  float tau = IGNITE + (x - uPath.x) / uPath.y;
  if (tau >= IGNITE && tau <= min(uT, BROKEN) && abs(dy) < 160.0) {
    float age = uT - tau;
    float e = heatAt(tau);
    // It drifts and twists in the high winds as it ages.
    float twist = (noise(vec3(xs / 70.0, 2.0, 5.0)) - 0.5) * 2.0;
    float off = twist * min(age, 6.0) * 1.8 - min(age, 6.0) * 0.6;
    float d = dy - off;
    float w1 = 0.8 + 1.6 * e + 1.6 * sqrt(age);
    float w2 = 3.0 + 9.0 * e + 6.0 * sqrt(age);
    // The plasma's grain along it, fixed where it was laid down.
    float grain = 0.6 + 0.8 * noise(vec3(xs / 9.0, tau * 3.0, 1.0));
    float hot = exp(-age / 0.55);
    float glow = exp(-age / 1.6);
    float wisp = exp(-age / 9.0);
    vec3 c = mix(white, orange, smoothstep(0.0, 0.45, age));
    c = mix(c, red, smoothstep(0.5, 2.2, age));
    c = mix(c, ember, smoothstep(2.2, 5.0, age));
    light += e * c * (blob(d, w1) * (3.2 * hot + 0.7 * glow) * grain + blob(d, w2) * (0.45 * hot + 0.22 * glow));
    // What is left of it, a faint wisp.
    light += e * ember * blob(d, w2 * 1.3) * 0.05 * wisp;
  }

  // The capsule itself, white-hot, and the light it throws round it.
  if (uT >= 0.0 && uT <= BROKEN) {
    float h = heatAt(uT);
    float hx = placeAt(uT);
    vec2 head = vec2(hx * uRes.x, wayY(hx));
    vec2 rel = (frag - head) / uDpr;
    float r = length(rel);
    float flick = 0.85 + 0.15 * sin(uT * 47.0) * sin(uT * 31.0 + 1.0);
    // The bow of hot air ahead of it, pressed flat along the way.
    float bow = exp(-pow(rel.x / (6.0 + 10.0 * h), 2.0) - pow(dy / (2.0 + 3.0 * h), 2.0));
    light += h * flick * (white * blob(r, 1.4 + 2.2 * h) * 7.0 + mix(orange, white, 0.4) * blob(r, 7.0 + 12.0 * h) * 1.1 + orange * bow * 0.6);
    light += h * h * orange * blob(r, 90.0 + 60.0 * h) * 0.11;
  }

  // The break: a flash, and pieces thrown on along the way, going out one by one.
  if (uT >= BREAK) {
    float dt = uT - BREAK;
    float bx = placeAt(BREAK);
    vec2 at = vec2(bx * uRes.x, wayY(bx));
    float r = length(frag - at) / uDpr;
    float flash = exp(-dt * 5.0);
    light += flash * (white * blob(r, 3.0 + 10.0 * dt) * 9.0 + mix(orange, white, 0.5) * blob(r, 26.0 + 30.0 * dt) * 1.4 + orange * blob(r, 220.0) * 0.14);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec3 h = hash33(vec3(fi, 4.0, 9.0));
      float life = 0.35 + 1.1 * h.x;
      float k = exp(-dt / life) * smoothstep(0.0, 0.04, dt);
      if (k < 0.002) continue;
      // Thrown on at the capsule's speed or a little less, slowing in the air.
      float go = v * (0.55 + 0.45 * h.y) * (1.0 - exp(-dt * 1.4)) / 1.4;
      float px = bx + go / (uRes.x / uDpr);
      vec2 p = vec2(px * uRes.x, wayY(px) + (h.z - 0.5) * 26.0 * uDpr * pow(dt, 0.8) - 6.0 * uDpr * dt * dt);
      vec2 q = (frag - p) / uDpr;
      // Drawn out along the way by their speed.
      float len = 2.0 + 14.0 * exp(-dt * 1.4);
      float s = exp(-pow(max(-q.x, 0.0) / len + max(q.x, 0.0) / 1.5, 2.0) - pow(q.y / 1.2, 2.0));
      light += k * (mix(white, orange, smoothstep(0.0, 0.8, dt)) * s * 3.0 + orange * blob(length(q), 8.0) * 0.4);
    }
  }

  // The faintest dawn at the edge's far end: the air there lit from under the edge, warm low down and cobalt over it.
  if (uDawn > 0.0) {
    vec3 rd = ray(frag);
    vec3 ro = vec3(0.0, RP + HC, 0.0);
    float tc = -dot(ro, rd);
    float over = length(ro + rd * max(tc, 0.0)) - RP;
    // How far round the edge from the sun, in radians.
    float ang = acos(clamp(dot(normalize(vec3(rd.x, 0.0, rd.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), -1.0, 1.0));
    float line = exp(-pow((over - 3.0) / 3.5, 2.0));
    float band = exp(-max(over, 0.0) / 22.0) * smoothstep(-6.0, 1.0, over);
    float high = exp(-max(over, 0.0) / 90.0) * smoothstep(-2.0, 4.0, over);
    float near = exp(-ang / 0.09);
    float wide = exp(-ang / 0.28);
    light += uDawn * (vec3(1.0, 0.55, 0.22) * line * near * 0.5 + vec3(1.0, 0.42, 0.16) * band * near * 0.12 + vec3(0.3, 0.32, 1.0) * high * wide * 0.035);
  }

  // The light over the scene, as light: it whitens where it is strong.
  vec3 add = 1.0 - exp(-light * 1.2);
  vec3 lin = pow(scene, vec3(2.2));
  lin = 1.0 - (1.0 - lin) * (1.0 - add);
  vec3 srgb = pow(lin, vec3(1.0 / 2.2));
  srgb += (hash12(frag + 17.0) - 0.5) / 255.0 * step(0.0001, dot(light, light));
  color = vec4(srgb, 1.0);
}`

/** The camera's aim for a framing: its focal length in device px, its pitch, and the sun's place under the far end of the edge. */
const aim = (f: Framing, W: number, H: number) => {
  const focal = H / 2 / Math.tan((f.fov * DEG) / 2)
  // The pitch that puts the edge's crest at its place: straight ahead, the edge is EDGE_DIP below the horizontal.
  const below = Math.atan(((f.edge - 0.5) * H) / focal)
  const pitch = -(EDGE_DIP - below)
  // The sun a little past the right edge of the frame, under the planet's edge.
  const bearing = Math.atan(((0.5 + 0.12) * W) / focal)
  const e = -EDGE_DIP - 4 * DEG
  const sun: [number, number, number] = [Math.cos(e) * Math.sin(bearing), Math.sin(e), Math.cos(e) * Math.cos(bearing)]
  return { focal, pitch, sun }
}

export function makeSky(canvas: HTMLCanvasElement, lost: () => void): Sky | null {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    premultipliedAlpha: false,
  })
  if (!gl) return null
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('night: a shader did not compile', gl.getShaderInfoLog(shader))
      return null
    }
    return shader
  }
  const link = (fragment: string) => {
    const vs = compile(gl.VERTEX_SHADER, VERTEX)
    const fs = compile(gl.FRAGMENT_SHADER, fragment)
    const program = gl.createProgram()
    if (!vs || !fs || !program) return null
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'p')
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('night:', gl.getProgramInfoLog(program))
      return null
    }
    return program
  }
  const scene = link(SCENE)
  const frame = link(FRAME)
  if (!scene || !frame) return null

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const u = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name)
  const S = {
    res: u(scene, 'uRes'),
    focal: u(scene, 'uFocal'),
    pitch: u(scene, 'uPitch'),
    dpr: u(scene, 'uDpr'),
    turn: u(scene, 'uTurn'),
  }
  const F = {
    res: u(frame, 'uRes'),
    focal: u(frame, 'uFocal'),
    pitch: u(frame, 'uPitch'),
    dpr: u(frame, 'uDpr'),
    scene: u(frame, 'uScene'),
    t: u(frame, 'uT'),
    dawn: u(frame, 'uDawn'),
    path: u(frame, 'uPath'),
    sun: u(frame, 'uSun'),
  }

  let framing: Framing | null = null
  let picture: { texture: WebGLTexture; fbo: WebGLFramebuffer } | null = null

  /** The scene, drawn into a picture of the canvas's size. */
  const paint = () => {
    if (!framing || picture) return
    const W = canvas.width
    const H = canvas.height
    const texture = gl.createTexture()
    const fbo = gl.createFramebuffer()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.viewport(0, 0, W, H)
    const { focal, pitch } = aim(framing, W, H)
    gl.useProgram(scene)
    gl.uniform2f(S.res, W, H)
    gl.uniform1f(S.focal, focal)
    gl.uniform1f(S.pitch, pitch)
    gl.uniform1f(S.dpr, framing.dpr)
    gl.uniform1f(S.turn, 0.31)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (texture && fbo) picture = { texture, fbo }
  }

  const drop = () => {
    if (!picture) return
    gl.deleteFramebuffer(picture.fbo)
    gl.deleteTexture(picture.texture)
    picture = null
  }

  const lose = (event: Event) => {
    event.preventDefault()
    lost()
  }
  canvas.addEventListener('webglcontextlost', lose)

  return {
    place: (next) => {
      framing = next
      const W = Math.max(1, Math.round(next.width * next.dpr))
      const H = Math.max(1, Math.round(next.height * next.dpr))
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }
      drop()
    },
    draw: ({ t, dawn }) => {
      if (!framing || gl.isContextLost()) return
      paint()
      if (!picture) return
      const W = canvas.width
      const H = canvas.height
      const { focal, pitch, sun } = aim(framing, W, H)
      gl.viewport(0, 0, W, H)
      gl.useProgram(frame)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, picture.texture)
      gl.uniform1i(F.scene, 0)
      gl.uniform2f(F.res, W, H)
      gl.uniform1f(F.focal, focal)
      gl.uniform1f(F.pitch, pitch)
      gl.uniform1f(F.dpr, framing.dpr)
      gl.uniform1f(F.t, t)
      gl.uniform1f(F.dawn, dawn)
      const p = framing.path
      gl.uniform4f(F.path, p.from, p.speed, p.under[0], p.under[1])
      gl.uniform3f(F.sun, ...sun)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    rest: drop,
    dispose: () => {
      canvas.removeEventListener('webglcontextlost', lose)
      drop()
      gl.deleteBuffer(buffer)
      gl.deleteProgram(scene)
      gl.deleteProgram(frame)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

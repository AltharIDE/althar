/*
 * Prototype, the Night first screen: the planet seen from orbit, at rest,
 * drawn once on the graphics card (and again only when the size changes). A
 * camera high over the night side looks out at the planet's edge: black
 * space and its stars over the dark curve, towns in gold under faint cloud,
 * the thin cobalt line of the air along the edge. Low along the edge, a faint
 * ember wisp where the capsule came through, cooling; at the edge's far end,
 * the faintest dawn.
 */

const DEG = Math.PI / 180

/** The planet and the camera's height over it, in km. */
const RP = 6360
const HC = 1100
/** How far below the horizontal the planet's edge stands from the camera. */
const EDGE_DIP = Math.acos(RP / (RP + HC))

/** Where the capsule came through: along the edge, as the frame's width has it. */
export interface Wisp {
  /** Where its fire caught, and where it broke, across the frame, 0 to 1. */
  from: number
  to: number
  /** How far under the edge's line it runs, in CSS px, at the frame's left and right. */
  under: [number, number]
  /** How bright what is left of it is, 1 as drawn. */
  glow: number
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
  /** How far the planet is turned under the camera: which towns are in view. */
  turn: number
  wisp: Wisp
  /** How far the dawn has come up at the edge's far end, 0 to 1. */
  dawn: number
}

export interface Sky {
  /** Draws the view for a framing, sizing the canvas to it. */
  draw: (framing: Framing) => void
  dispose: () => void
}

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
out vec4 color;

uniform vec2 uRes;
uniform float uFocal;
uniform float uPitch;
uniform float uDpr;
uniform float uTurn;
// The wisp: where it caught and broke (0 to 1 across), how far under the edge it runs at the left and the right (CSS px).
uniform vec4 uWisp;
uniform float uWispGlow;
uniform float uDawn;
// The sun, under the edge's far end.
uniform vec3 uSun;

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

// The camera: its ray through a pixel.
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
  vec3 at = cell + 0.2 + 0.6 * hash33(cell + 7.0);
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
  s += starLayer(d, 52.0, 0.12, 0.5, 5.0, px);
  s += starLayer(d, 130.0, 0.05 + 0.3 * band * smoothstep(0.4, 0.7, dust), 0.32, 11.0, px);
  return s + glow;
}

vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

// The wisp's way across the screen, in device px from the bottom: at a place across, 0 to 1.
float wayY(float x) {
  float ux = (x - 0.5) * uRes.x / uFocal;
  float under = mix(uWisp.z, uWisp.w, x) * uDpr;
  return 0.5 * uRes.y + edgeAt(ux) * uFocal - under;
}
float blob(float d, float r) { return exp(-d * d / (r * r)); }

// What is left of the capsule's fire: a wisp along the edge, cooled to embers, oldest (and widest, faintest) where it caught.
vec3 wisp(vec2 frag) {
  float x = frag.x / uRes.x;
  float along = (x - uWisp.x) / (uWisp.y - uWisp.x);
  if (along < -0.05 || along > 1.05) return vec3(0.0);
  float wy = wayY(x);
  float slope = (wayY(x + 0.002) - wayY(x - 0.002)) / (0.004 * uRes.x);
  float dy = (frag.y - wy) / uDpr / sqrt(1.0 + slope * slope);
  if (abs(dy) > 160.0) return vec3(0.0);
  float xs = frag.x / uDpr;
  // How hot it ran here: a glow catching, building to its height, gone where it broke.
  float e = (0.08 + 0.92 * pow(smoothstep(0.0, 0.86, along), 1.7)) * smoothstep(-0.05, 0.1, along) * (1.0 - smoothstep(0.86, 1.04, along));
  // How long ago it passed, in seconds: cooling and spreading since.
  float age = mix(9.5, 4.8, clamp(along, 0.0, 1.0));
  // Drifted and twisted in the high winds.
  float twist = (noise(vec3(xs / 70.0, 2.0, 5.0)) - 0.5) * 2.0;
  float d = dy - (twist * 9.0 - 3.0) * smoothstep(0.0, 0.3, age / 9.5);
  float w1 = 1.0 + 1.2 * e + 1.0 * sqrt(age);
  float w2 = 4.0 + 6.0 * e + 4.5 * sqrt(age);
  float grain = 0.55 + 0.9 * noise(vec3(xs / 9.0, 3.0, 1.0));
  float warm = exp(-(age - 4.8) / 2.2);
  vec3 red = vec3(1.0, 0.3, 0.07);
  vec3 ember = vec3(0.6, 0.16, 0.06);
  vec3 c = mix(ember, red, warm);
  return uWispGlow * e * (c * blob(d, w1) * (0.05 + 0.14 * warm) * grain + ember * blob(d, w2) * 0.025);
}

// The faintest dawn at the edge's far end: the air there lit from under the edge, warm low down and cobalt over it.
vec3 dawn(vec3 rd, float over) {
  // How far round the edge from the sun, in radians.
  float ang = acos(clamp(dot(normalize(vec3(rd.x, 0.0, rd.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), -1.0, 1.0));
  float line = exp(-pow((over - 3.0) / 3.5, 2.0));
  float band = exp(-max(over, 0.0) / 22.0) * smoothstep(-6.0, 1.0, over);
  float high = exp(-max(over, 0.0) / 90.0) * smoothstep(-2.0, 4.0, over);
  float near = exp(-ang / 0.12);
  float wide = exp(-ang / 0.3);
  return uDawn * (vec3(1.0, 0.58, 0.26) * line * near * 0.75 + vec3(1.0, 0.42, 0.16) * band * near * 0.2 + vec3(0.3, 0.32, 1.0) * high * wide * 0.035);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec3 rd = ray(frag);
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
  vec3 lin = aces(col);
  float lum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  lin = mix(lin, lin * vec3(1.035, 1.0, 0.94), smoothstep(0.45, 1.0, lum));

  // The wisp and the dawn over it, as light: it whitens where it is strong. And the air's cobalt over the edge, wide, as the night pages light it.
  vec3 light = wisp(frag) + dawn(rd, over);
  light += vec3(0.045, 0.07, 1.0) * 0.095 * exp(-max(over, 0.0) / 230.0) * smoothstep(-3.0, 4.0, over);
  vec3 add = 1.0 - exp(-light * 1.2);
  lin = 1.0 - (1.0 - lin) * (1.0 - add);

  vec3 srgb = pow(lin, vec3(1.0 / 2.2));
  // Dither, so the dark gradients never band.
  srgb += (hash12(frag) - 0.5) / 255.0;
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

/**
 * The view on `canvas`, or null without the graphics card. Its shader is
 * compiled in the background where the browser can (the page isn't held up
 * by it): `drawn` is called each time the view is drawn, `failed` if it
 * can't be, or the browser takes the graphics card back.
 */
export function makeSky(canvas: HTMLCanvasElement, on: { drawn: () => void; failed: () => void }): Sky | null {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
  })
  if (!gl || gl.isContextLost()) return null
  const parallel = gl.getExtension('KHR_parallel_shader_compile')
  const shader = (type: number, source: string) => {
    const it = gl.createShader(type)
    if (!it) return null
    gl.shaderSource(it, source)
    gl.compileShader(it)
    return it
  }
  const vs = shader(gl.VERTEX_SHADER, VERTEX)
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.bindAttribLocation(program, 0, 'p')
  gl.linkProgram(program)

  const uniforms = () => {
    const u = (name: string) => gl.getUniformLocation(program, name)
    return {
      res: u('uRes'),
      focal: u('uFocal'),
      pitch: u('uPitch'),
      dpr: u('uDpr'),
      turn: u('uTurn'),
      wisp: u('uWisp'),
      wispGlow: u('uWispGlow'),
      dawn: u('uDawn'),
      sun: u('uSun'),
    }
  }

  let state: 'compiling' | 'ready' | 'failed' = 'compiling'
  let wanted: Framing | null = null
  let buffer: WebGLBuffer | null = null
  let U: ReturnType<typeof uniforms> | null = null
  let poll = 0

  const paint = (f: Framing) => {
    if (!U || gl.isContextLost()) return
    const W = Math.max(1, Math.round(f.width * f.dpr))
    const H = Math.max(1, Math.round(f.height * f.dpr))
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W
      canvas.height = H
    }
    const { focal, pitch, sun } = aim(f, W, H)
    gl.viewport(0, 0, W, H)
    gl.useProgram(program)
    gl.uniform2f(U.res, W, H)
    gl.uniform1f(U.focal, focal)
    gl.uniform1f(U.pitch, pitch)
    gl.uniform1f(U.dpr, f.dpr)
    gl.uniform1f(U.turn, f.turn)
    gl.uniform4f(U.wisp, f.wisp.from, f.wisp.to, f.wisp.under[0], f.wisp.under[1])
    gl.uniform1f(U.wispGlow, f.wisp.glow)
    gl.uniform1f(U.dawn, f.dawn)
    gl.uniform3f(U.sun, ...sun)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    on.drawn()
  }

  /** Once compiled: the triangle that covers the canvas, the uniforms, and the view if it was asked for meanwhile. */
  const finish = () => {
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) console.warn('night:', gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(program))
      state = 'failed'
      on.failed()
      return
    }
    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    U = uniforms()
    state = 'ready'
    if (wanted) paint(wanted)
  }
  const wait = () => {
    if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
      poll = requestAnimationFrame(wait)
      return
    }
    finish()
  }
  // Looked at from the next frame on, so the page paints first.
  poll = requestAnimationFrame(wait)

  const lose = (event: Event) => {
    event.preventDefault()
    on.failed()
  }
  canvas.addEventListener('webglcontextlost', lose)

  return {
    draw: (f) => {
      wanted = f
      if (state === 'ready') paint(f)
    },
    dispose: () => {
      cancelAnimationFrame(poll)
      canvas.removeEventListener('webglcontextlost', lose)
      if (state === 'compiling') {
        gl.deleteShader(vs)
        gl.deleteShader(fs)
      }
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      // The context is the canvas's for good: a canvas mounted again (as React's strict mode does) gets the same one back, so it is left alive.
    },
  }
}

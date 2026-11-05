/*
 * Prototype (B): the sections' sky as a line engraving, drawn on the
 * graphics card in tiles that are laid into the page, so the engraving
 * scrolls with it as print does and is never drawn again while it scrolls.
 *
 * What is drawn is a tone, from paper to full ink, cut as parallel lines
 * whose width follows it, wavering a little as a hand cuts them; where a
 * line would be too fine to cut it breaks into dashes, as an engraving's
 * lines break up in its lights; where the tone is deepest a second set
 * crosses the first. The sky is ruled across; the planet's body is cut in
 * arcs about its middle, straightening the lower they are; clouds in lines
 * that follow their forms. Stars are left as paper, the brightest as small
 * crosses. Words are kept clear: the tone falls to paper round them.
 *
 * Top to bottom (the page's own measure, from the sections' top): the night,
 * densest just under the band and lightening down to the planet's edge, a
 * thin line of paper (the air) along it; the planet's body, its clouds seen
 * from above, larger as they come nearer; banks of cloud where the page
 * comes down to them; the open sky under them; and paper by the download.
 */

/** Where things stand in the sections, in CSS px from their top-left. */
export interface Scene {
  w: number
  h: number
  /** The top of the planet's edge, under the first picture, and how large the planet is. */
  limb: number
  radius: number
  /** Where the clouds come up, the foot of the great bank beside the claim over them, where they end, where the sky opens, and where the download is. */
  clouds: number
  bank: number
  under: number
  open: number
  end: number
  /** The sky's lines, a line every `period` px. */
  period: number
  /** Boxes of words: x, y, width, height. */
  clear: ReadonlyArray<readonly [number, number, number, number]>
}

const MOST_CLEAR = 24

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uDpr;
uniform vec2 uOrigin;
uniform float uW;
uniform float uH;
uniform float uLimb;
uniform float uR;
uniform vec4 uZones;
uniform float uBank;
uniform float uP;
uniform vec4 uClear[${MOST_CLEAR}];
uniform int uClearN;
uniform vec3 uPaper;
uniform vec3 uInk;
out vec4 o;

float px;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}

/*
 * Lines across v, along u, a line every P px, inking a share c of the plate.
 * Where the tone falls too low to cut, a line thins and fades to its point
 * and stops: each line where its own threshold says, set by the line and
 * wandering only slowly along it, so toward a light the lines end one by one
 * at different places, as an engraver's do, and where the tone is even they
 * run on unbroken.
 */
float hatch(float v, float u, float P, float c, float seed) {
  if (c <= 0.003) return 0.0;
  float n = floor(v / P);
  float f = abs(fract(v / P) - 0.5) * P;
  float least = 0.9 * px;
  float w = c * P;
  float a = 1.0;
  if (w < least) {
    float thr = 0.1 + 0.8 * fract(hash(vec2(n, seed)) + 0.3 * noise(vec2(u / 600.0, n * 0.37 + seed)));
    float t = smoothstep(thr - 0.16, thr + 0.16, w / least);
    w = least * mix(0.4, 1.0, t);
    a = t;
  }
  return a * (1.0 - smoothstep(w * 0.5 - 0.5 * px, w * 0.5 + 0.5 * px, f));
}

float box(vec2 p, vec4 b, float pad, float r) {
  vec2 c = b.xy + b.zw * 0.5;
  vec2 q = abs(p - c) - (b.zw * 0.5 + pad) + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

/* 1 away from the words, falling to 0 round them: a wide, uneven falloff, its edge wandering outward, never into them. */
float clearOf(vec2 p) {
  float w = clamp((uW - 390.0) / 890.0, 0.0, 1.0);
  float pad = mix(8.0, 14.0, w), feather = mix(56.0, 104.0, w);
  float wander = fbm(p * 0.009 + 5.0) * mix(36.0, 70.0, w);
  float k = 1.0;
  for (int i = 0; i < ${MOST_CLEAR}; i++) {
    if (i >= uClearN) break;
    k = min(k, smoothstep(0.0, feather, box(p, uClear[i], pad, 48.0) - wander));
  }
  return k;
}

/* How far a puff reaches at q's angle: its edge in small rounded bumps, as cumulus is, with cusps between. */
float reach(vec2 q, float r, float seed) {
  float n = max(4.0, floor(r / 9.0));
  return r * (0.9 + 0.1 * abs(sin(atan(q.x, -q.y) * n * 0.5 + seed * 7.0)));
}

/* The puffs of a bank of cumulus on its base y0, about s px across: the puff in front at p, as its middle, its radius and its edge's reach at p (radius 0 outside the bank). */
vec4 puffOf(vec2 p, float y0, float s, float seed) {
  vec4 best = vec4(0.0);
  if (p.y > y0) return best;
  float i = floor(p.x / s);
  float front = -1e6;
  for (int k = -2; k <= 2; k++) {
    float c = i + float(k);
    float h1 = hash(vec2(c, seed)), h2 = hash(vec2(c, seed + 5.0)), h3 = hash(vec2(c, seed + 9.0)), h4 = hash(vec2(c, seed + 13.0));
    float cx = (c + 0.5 + (h1 - 0.5) * 0.5) * s;
    float swell = smoothstep(0.3, 0.72, noise(vec2(c * 0.27 + seed, seed)));
    // The far bank runs the width unbroken; the great one towers at the right, beside its claim.
    if (seed < 40.0) swell = max(swell, 0.35);
    else swell = max(swell * 0.6, smoothstep(0.42, 0.8, cx / uW) * (0.75 + 0.25 * h3));
    if (swell < 0.04) continue;
    float r = s * (0.42 + 0.48 * h2) * (0.45 + 0.75 * swell);
    float cy = y0 - r * (0.3 + 0.3 * h3);
    vec2 q = p - vec2(cx, cy);
    float e = reach(q, r, h1);
    if (dot(q, q) < e * e && cy > front) { best = vec4(cx, cy, r, e); front = cy; }
    float r2 = r * (0.48 + 0.3 * h4) * swell;
    float cy2 = cy - r * (0.62 + 0.25 * h3);
    float cx2 = cx + (h4 - 0.5) * r * 0.7;
    q = p - vec2(cx2, cy2);
    e = reach(q, r2, h4);
    if (r2 > 6.0 && dot(q, q) < e * e && cy2 > front) { best = vec4(cx2, cy2, r2, e); front = cy2; }
  }
  return best;
}

void main() {
  px = 1.0 / uDpr;
  vec2 p = uOrigin + vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uDpr;
  float clr = clearOf(p);
  // A hand's slight waver: long and gentle.
  float wob = (noise(vec2(p.x / 240.0, p.y / 70.0)) - 0.5) * 1.3;
  float PS = uP * 1.6;

  vec2 C = vec2(uW * 0.5, uLimb + uR);
  float dc = length(p - C);
  // Above the planet's middle, how far outside its edge; below it, all of it is the planet, deeper the lower.
  float d = p.y < C.y ? dc - uR : -(uR - abs(p.x - C.x) + (p.y - C.y));
  float ink = 0.0;
  float star = 0.0;

  if (d > 0.0) {
    // ---- the night: one ruling, its lines nearly touching, thinning only in the air over the planet's edge ----
    float T = 0.86;
    T *= mix(0.2, 1.0, smoothstep(0.0, 150.0, d));
    // It comes up out of the band unevenly, line by line.
    float rise = fbm(vec2(p.x * 0.0045, 3.0)) * 120.0;
    T *= smoothstep(rise, rise + 140.0, p.y);
    T *= clr * (0.97 + 0.06 * fbm(p * 0.003));
    ink = hatch(p.y + wob, p.x, uP * 1.1, T, 1.0);
    // Stars, left as paper; the brightest as small crosses, the lines held back round them.
    vec2 cell = floor(p / 23.0);
    float h = hash(cell + 11.0);
    if (h > 0.8 && clr > 0.98) {
      vec2 at = (cell + 0.2 + 0.6 * vec2(hash(cell + 3.0), hash(cell + 7.0))) * 23.0;
      float m = pow(hash(cell + 19.0), 3.0);
      float r = mix(0.7, 1.6, m);
      float dist = length(p - at);
      star = 1.0 - smoothstep(r - px, r + px, dist);
      if (m > 0.5) {
        vec2 q = abs(p - at);
        float arm = mix(4.0, 10.0, (m - 0.5) / 0.5);
        float cross = max(
          (1.0 - smoothstep(0.4, 0.4 + px, q.y)) * (1.0 - smoothstep(arm * 0.3, arm, q.x)),
          (1.0 - smoothstep(0.4, 0.4 + px, q.x)) * (1.0 - smoothstep(arm * 0.3, arm, q.y))
        );
        star = max(star, cross);
        ink *= smoothstep(r + 0.5, r + 4.5, dist);
      }
      star *= smoothstep(120.0, 280.0, d) * smoothstep(rise + 60.0, rise + 200.0, p.y);
    }
    // The air: a thin line of paper along the planet's edge.
    ink *= smoothstep(1.2, 2.8, d);
  } else {
    float q = -d;
    float y = p.y;
    float T = 0.0;
    float lineV = y + wob;
    float lineU = p.x;
    float P = PS;

    // ---- the planet: an exact circle, cut in arcs about its middle; lit along its edge and darkening inward, then dissolving unevenly ----
    float ang = atan(p.x - C.x, C.y - p.y) * uR;
    float body = mix(0.16, 0.84, smoothstep(6.0, 300.0, q));
    float fall = 520.0 + fbm(vec2(p.x * 0.0035, 7.0)) * 300.0;
    float Tp = body * (1.0 - smoothstep(fall, fall + 150.0, q)) * smoothstep(2.6, 4.2, q);
    if (Tp > 0.0) {
      T = Tp;
      lineV = dc + wob * 0.4;
      lineU = ang;
      P = uP * 1.1;
    }
    // Its outline, a fine line inside the paper of the air.
    ink = max(ink, (1.0 - smoothstep(0.42, 0.42 + px, abs(q - 1.4))) * clr * (1.0 - smoothstep(fall, fall + 150.0, q)));

    // ---- the high sky under it: long level lines, lightening toward the clouds' horizon ----
    float deck = uZones.x;
    float wx = fbm(vec2(p.x * 0.004, 11.0));
    float Ts = 0.2 * smoothstep(uLimb + 980.0 + wx * 240.0, uLimb + 1320.0 + wx * 240.0, y);
    Ts *= 1.0 - 0.55 * smoothstep(mix(uLimb, deck, 0.6), deck, y);
    // It is the sky over the clouds' horizon only; behind the far bank its own sky takes over.
    Ts *= 1.0 - step(deck - 140.0 + wx * 120.0, y);

    // ---- the clouds: a far bank along the horizon over the claim, and a great bank towering beside it ----
    float k = clamp(uW / 1280.0, 0.5, 1.25);
    bool inCloud = false;
    for (int j = 1; j >= 0; j--) {
      float fj = float(j);
      float s = (fj == 0.0 ? 64.0 : 200.0) * k;
      // Its base is soft-edged, not ruled.
      float y0 = (fj == 0.0 ? deck : uBank) + (noise(vec2(p.x / (s * 0.6), fj)) - 0.5) * s * 0.12;
      vec4 f = puffOf(p, y0, s, 31.0 + fj * 13.0);
      if (f.z <= 0.0) continue;
      inCloud = true;
      float dist = length(p - f.xy);
      vec2 n2 = (p - f.xy) / f.z;
      float rr = min(1.0, dot(n2, n2));
      vec3 L = normalize(vec3(0.55, -0.72, 0.42));
      float lit = dot(vec3(n2, sqrt(1.0 - rr)), L);
      float Tc = 0.56 * smoothstep(0.4, 1.4, 1.0 - lit) * smoothstep(0.2, 0.9, dist / f.w);
      float base = smoothstep(y0 - s * 0.28, y0, y);
      T = max(Tc, 0.48 * base);
      lineV = y - 0.2 * f.z * (1.0 - rr) * (1.0 - base) + wob * 0.5;
      lineU = p.x;
      P = uP;
      float e = f.w - dist;
      float top = 1.0 - smoothstep(-0.2, 0.3, n2.y);
      float keep = step(hash(vec2(floor(atan(n2.x, -n2.y) * f.z / 6.0), fj + f.x)), 0.75) * top * (fj > 0.0 ? 1.0 : 0.0);
      ink = max(ink, (1.0 - smoothstep(0.3, 0.3 + px, abs(e - 0.5))) * keep * clr);
      break;
    }
    if (!inCloud) {
      // The sky behind the far bank, ruled, its top fading in unevenly; and under it, the sea of cloud thinning toward us.
      float Tb = 0.32 * smoothstep(deck - 420.0 + wx * 200.0, deck - 140.0 + wx * 120.0, y) * (1.0 - step(deck + 4.0, y));
      float sea = 0.2 * smoothstep(deck - 8.0, deck + 6.0, y) * (1.0 - smoothstep(deck + 40.0, deck + 170.0 + wx * 180.0, y));
      // Under the great bank, its shadowed foot thinning away.
      float foot = 0.34 * smoothstep(0.42, 0.75, p.x / uW) * smoothstep(uBank - 30.0, uBank, y) * (1.0 - smoothstep(uBank + 10.0, uBank + 90.0 + wx * 140.0, y));
      float Tl = max(max(Ts, Tb), max(sea, foot));
      if (Tl > T) { T = Tl; lineV = y + wob * 0.6; lineU = p.x; P = PS; }
    }

    // ---- under the clouds: their underside, a ragged band of level lines; then the open sky, a few long drifts ----
    float under = uZones.y;
    float rag = (fbm(vec2(p.x * 0.004, 3.0)) - 0.5) * 120.0;
    float Tu = 0.3 * smoothstep(under - 90.0 + rag, under + rag * 0.4, y) * (1.0 - smoothstep(under + 10.0 + rag * 0.4, under + 170.0 + rag, y));
    Tu *= smoothstep(0.3, 0.55, fbm(vec2(p.x * 0.003, 2.0)));
    float drift = smoothstep(0.64, 0.84, fbm(vec2(p.x * 0.0012, y * 0.011) + 40.0));
    Tu = max(Tu, drift * 0.085 * smoothstep(under + 120.0, under + 420.0, y) * (1.0 - smoothstep(uZones.w - 500.0, uZones.w, y)));
    if (Tu > T && !inCloud) { T = Tu; lineV = y + wob * 0.6; lineU = p.x; P = PS; }

    T *= clr;
    ink = max(ink, hatch(lineV, lineU, P, min(T, 0.84), 4.0));
  }
  ink *= 1.0 - star;
  o = vec4(mix(uPaper, uInk, clamp(ink, 0.0, 1.0)), 1.0);
}`

export interface Engraver {
  /** Draws the part of the scene from `top`, `height` px tall, into `target` at `dpr` device px a CSS px. */
  draw: (target: HTMLCanvasElement, scene: Scene, top: number, height: number, dpr: number) => boolean
  dispose: () => void
}

const rgb = (css: string): [number, number, number] => {
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) return [0, 0, 0]
  probe.fillStyle = css
  probe.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data
  return [r / 255, g / 255, b / 255]
}

export function makeEngraver(paper: string, ink: string, onLost: () => void): Engraver | null {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true })
  if (!gl) return null
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
    return shader
  }
  const program = gl.createProgram()!
  try {
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
  } catch (error) {
    console.error(error)
    return null
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program))
    return null
  }
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const at = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(at)
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)
  const u = (name: string) => gl.getUniformLocation(program, name)
  const U = {
    size: u('uSize'),
    dpr: u('uDpr'),
    origin: u('uOrigin'),
    w: u('uW'),
    h: u('uH'),
    limb: u('uLimb'),
    r: u('uR'),
    zones: u('uZones'),
    bank: u('uBank'),
    period: u('uP'),
    clear: u('uClear'),
    clearN: u('uClearN'),
    paper: u('uPaper'),
    ink: u('uInk'),
  }
  gl.uniform3fv(U.paper, rgb(paper))
  gl.uniform3fv(U.ink, rgb(ink))
  let lost = false
  const lose = (event: Event) => {
    event.preventDefault()
    lost = true
    onLost()
  }
  canvas.addEventListener('webglcontextlost', lose)

  return {
    draw: (target, scene, top, height, dpr) => {
      if (lost) return false
      const w = Math.round(scene.w * dpr)
      const h = Math.round(height * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.uniform2f(U.size, w, h)
      gl.uniform1f(U.dpr, dpr)
      gl.uniform2f(U.origin, 0, top)
      gl.uniform1f(U.w, scene.w)
      gl.uniform1f(U.h, scene.h)
      gl.uniform1f(U.limb, scene.limb)
      gl.uniform1f(U.r, scene.radius)
      gl.uniform4f(U.zones, scene.clouds, scene.under, scene.open, scene.end)
      gl.uniform1f(U.bank, scene.bank)
      gl.uniform1f(U.period, scene.period)
      // Only the words near this tile.
      const near = scene.clear.filter(([, y, , bh]) => y + bh > top - 120 && y < top + height + 120).slice(0, MOST_CLEAR)
      const flat = new Float32Array(MOST_CLEAR * 4)
      near.forEach((b, i) => flat.set(b, i * 4))
      gl.uniform4fv(U.clear, flat)
      gl.uniform1i(U.clearN, near.length)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (target.width !== w || target.height !== h) {
        target.width = w
        target.height = h
      }
      const ctx = target.getContext('2d')
      if (!ctx) return false
      ctx.drawImage(canvas, 0, 0)
      return true
    },
    dispose: () => {
      canvas.removeEventListener('webglcontextlost', lose)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

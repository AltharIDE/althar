/*
 * What the capsule's window sees, drawn on the graphics card: for each pixel
 * of the glass, the sky beyond and the fire in front of it, by the
 * photograph's own measure, so they stand where the glass is at any size.
 *
 * The sky is a photograph from high up after re-entry, dark until the fire
 * breaks, shimmering in the heat. The fire is a photograph of plasma, in two
 * layers, far and near, streaming along its own streaks and smeared by the
 * shutter the faster it goes; sparks shoot past with it; and at the break it
 * tears away in tatters, swept on downstream. Once it is gone, only the sky
 * is drawn.
 */

/**
 * Where the plate stands on the screen, and where the canvas does, in CSS
 * px; the canvas's px to a CSS px; and, by the photograph's measure (plate
 * px), the sky picture's box over it and how large the fire is drawn on it
 * (1 on the wide photograph; more on the tall one, whose px are smaller on a
 * phone's screen, so the fire looks the same size).
 */
export interface Placing {
  plate: { left: number; top: number; scale: number }
  box: { x: number; y: number; w: number; h: number }
  dpr: number
  sky: { x: number; y: number; w: number; h: number }
  unit: number
}

export interface Moment {
  /** Seconds since the page opened: what the shimmer runs on. */
  t: number
  /** How hot it is (0 to 1), how far the fire has streamed and how fast (in the plasma's widths), how far it has torn away, how white the glass has flashed. */
  heat: number
  flow: number
  speed: number
  broken: number
  white: number
  /** How far the sky has drifted since the break, in the wide photograph's px. */
  drift: number
}

export interface Fire {
  place: (placing: Placing) => void
  draw: (moment: Moment) => void
  /** Gives the graphics card its memory back. */
  dispose: () => void
}

/** How wide the plasma photograph is drawn, in the wide photograph's px. */
const PLASMA = 2100
/** The shutter, in seconds: how long the fire is smeared for. */
const SHUTTER = 1 / 40
/** The most samples a pixel takes along the smear, for each layer of the fire. */
const TAPS = 8

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uBox;        // the canvas on the screen: x, y, height (CSS px), its px to a CSS px
uniform vec3 uPlate;      // the plate on the screen: left, top (CSS px), CSS px to a plate px
uniform vec4 uSkyAt;      // the sky picture over the plate: x, y, w, h (plate px)
uniform float uUnit;      // plate px to the fire's own px
uniform vec2 uPlasmaSize; // the plasma photograph drawn, in the fire's px
uniform float uT, uHeat, uFlow, uSmear, uBroken, uWhite, uDrift;
uniform int uTaps;
uniform sampler2D uSky, uPlasma;
out vec4 colour;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float jitter(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// Linear light back to the sRGB a picture is stored in, exactly.
vec3 srgb(vec3 l) {
  l = clamp(l, 0.0, 1.0);
  return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l));
}

// Along the plasma's own streaks, down to the right.
const vec2 ALONG = vec2(0.963, 0.27);

// One layer of the fire: the plasma at a scale, streaming at a pace, sampled along the smear, jittered so the samples blend into a streak.
vec3 plasma(vec2 fp, float scale, float pace) {
  vec3 sum = vec3(0.0);
  float j = jitter(gl_FragCoord.xy + pace);
  vec2 size = uPlasmaSize * scale;
  for (int i = 0; i < ${TAPS}; i++) {
    if (i >= uTaps) break;
    float k = (float(i) + j) / float(uTaps) - 0.5;
    float along = (uFlow + k * uSmear) * pace * size.x;
    sum += texture(uPlasma, (fp - ALONG * along) / size + vec2(pace * 0.37, pace * 0.21)).rgb;
  }
  return sum / float(uTaps);
}

void main() {
  vec2 css = vec2(uBox.x + gl_FragCoord.x / uBox.w, uBox.y + uBox.z - gl_FragCoord.y / uBox.w);
  vec2 px = (css - uPlate.xy) / uPlate.z;
  // The fire's own px: the same size on the screen whichever photograph it is behind.
  vec2 fp = px / uUnit;

  // The sky, shimmering in the heat, drifting once the fire has gone; dark until then, the glow drowning what light there is.
  vec2 shimmer = vec2(0.0);
  if (uHeat > 0.0) shimmer = (vec2(noise(fp * 0.012 + vec2(uT * 4.0, 0.0)), noise(fp * 0.015 + vec2(7.0, uT * 3.0))) - 0.5) * 26.0 * uUnit * uHeat;
  vec3 c = texture(uSky, (px + shimmer + vec2(uDrift * uUnit, 0.0) - uSkyAt.xy) / uSkyAt.zw).rgb * mix(0.05, 1.0, uBroken * uBroken);

  if (uBroken < 1.0) {
    // The fire, far and near: the far layer finer and slower, the near one larger and faster.
    vec3 fire = plasma(fp, 1.0, 1.0) * 0.8 + plasma(fp, 1.7, 1.55) * 0.7;
    // A faint glow at first, deep orange as it builds; only its hottest cores go white, and only near its height.
    float lum = dot(fire, vec3(0.3, 0.5, 0.2));
    fire = fire * fire * (0.03 + 3.4 * pow(uHeat, 1.4)) * vec3(1.0, 0.8, 0.66) + vec3(1.0, 0.86, 0.66) * lum * lum * lum * 4.0 * pow(uHeat, 3.0);
    // Torn away at the break, in tatters, the tears swept along with it.
    float tatter = noise((fp - ALONG * uFlow * uPlasmaSize.x * 1.55) * 0.0035) * 0.7 + noise(fp * 0.011) * 0.3;
    fire *= smoothstep(uBroken - 0.25, uBroken + 0.05, tatter) * (1.0 - smoothstep(0.85, 1.0, uBroken));

    // Sparks shooting past with it: in rows along the streaks, each a short bright stroke, more of them the hotter.
    vec2 q = vec2(dot(fp, ALONG), dot(fp, vec2(-ALONG.y, ALONG.x)));
    float row = floor(q.y / 34.0);
    float r = hash(vec2(row, 3.0));
    float lane = (fract(q.y / 34.0) - 0.5) * 34.0;
    float period = 900.0 + 1600.0 * r;
    float head = mod(r * 5000.0 + uFlow * uPlasmaSize.x * (1.8 + 1.4 * hash(vec2(row, 9.0))), period);
    float behind = mod(q.x - head, period);
    float tail = 24.0 + uSmear * uPlasmaSize.x * 2.4;
    float spark = exp(-lane * lane / 3.0) * smoothstep(tail, 0.0, behind) * step(0.55 - 0.4 * uHeat, r) * step(behind, tail);
    c += fire + vec3(1.0, 0.72, 0.38) * spark * (uHeat * 1.6 + (1.0 - uBroken) * 0.2) * (1.0 - smoothstep(0.6, 1.0, uBroken));
  }

  c = mix(c, vec3(1.0, 0.95, 0.88) * 2.2, uWhite);
  // The fire's light is pressed into what a screen shows; once it has gone, under the break's flash, the sky is the picture as it is, so the page can show
  // the picture itself in its place at rest (Hero.tsx) with nothing changing.
  vec3 pressed = pow(1.0 - exp(-c * 1.05), vec3(1.0 / 2.2));
  colour = vec4(mix(pressed, srgb(c), smoothstep(0.6, 1.0, uBroken)), 1.0);
}`

/**
 * The fire on `canvas`, from the photographs of the sky and the plasma; null
 * where the browser can't draw it. If the graphics card takes the canvas back,
 * `onLost` is told, and the page shows the sky without it.
 */
export function makeFire(canvas: HTMLCanvasElement, sky: HTMLImageElement, plasma: HTMLImageElement, onLost: () => void): Fire | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' })
  if (!gl) return null
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, source)
    gl.compileShader(s)
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
  }
  const vs = shader(gl.VERTEX_SHADER, VERTEX)
  const fs = shader(gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)

  // One triangle over the whole canvas.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const at = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(at)
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)

  const names = [
    'uBox',
    'uPlate',
    'uSkyAt',
    'uUnit',
    'uPlasmaSize',
    'uT',
    'uHeat',
    'uFlow',
    'uSmear',
    'uBroken',
    'uWhite',
    'uDrift',
    'uTaps',
    'uSky',
    'uPlasma',
  ] as const
  const u = Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<
    (typeof names)[number],
    WebGLUniformLocation | null
  >

  const texture = (img: HTMLImageElement, unit: number, wrap: number) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
  }
  // The sky stops at its edges; the plasma repeats every way.
  texture(sky, 0, gl.CLAMP_TO_EDGE)
  texture(plasma, 1, gl.REPEAT)
  gl.uniform1i(u.uSky, 0)
  gl.uniform1i(u.uPlasma, 1)
  gl.uniform2f(u.uPlasmaSize, PLASMA, (PLASMA * plasma.naturalHeight) / plasma.naturalWidth)

  let lost = false
  const lose = () => {
    lost = true
    onLost()
  }
  canvas.addEventListener('webglcontextlost', lose)

  return {
    place: ({ plate, box, dpr, sky: at, unit }) => {
      if (lost) return
      canvas.width = Math.max(1, Math.round(box.w * dpr))
      canvas.height = Math.max(1, Math.round(box.h * dpr))
      Object.assign(canvas.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` })
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform4f(u.uBox, box.x, box.y, canvas.height / dpr, dpr)
      gl.uniform3f(u.uPlate, plate.left, plate.top, plate.scale)
      gl.uniform4f(u.uSkyAt, at.x, at.y, at.w, at.h)
      gl.uniform1f(u.uUnit, unit)
    },
    draw: ({ t, heat, flow, speed, broken, white, drift }) => {
      if (lost) return
      const smear = speed * SHUTTER
      // As many samples as the smear is long, in the plasma's own px: one when it is slow.
      gl.uniform1i(u.uTaps, Math.min(TAPS, Math.max(1, Math.ceil((smear * plasma.naturalWidth) / 4))))
      gl.uniform1f(u.uT, t)
      gl.uniform1f(u.uHeat, heat)
      gl.uniform1f(u.uFlow, flow)
      gl.uniform1f(u.uSmear, smear)
      gl.uniform1f(u.uBroken, broken)
      gl.uniform1f(u.uWhite, white)
      gl.uniform1f(u.uDrift, drift)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose: () => {
      canvas.removeEventListener('webglcontextlost', lose)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

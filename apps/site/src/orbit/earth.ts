import { DIP, EARTH } from './journey'

/*
 * The Earth from the station, drawn on the graphics card: for each pixel of
 * the glass, the ray through the photograph's lens from 420 km up, to the
 * ground or past it into space.
 *
 * The ground is the two photographs of it, by day and by night, laid on the
 * sphere along the track and slid along by the distance gone; where the sun
 * is up it is the day's, where it is down the night's lights, warm low sun
 * between. The faster the view runs, the longer the shutter smears it along
 * the track, so the lights are drawn out into streaks. Toward the limb the
 * air thickens into haze; above it, a thin blue line by day, a faint airglow
 * by night, the colours of the sunrise near the sun, the stars, and the sun
 * itself once it clears the limb.
 *
 * The camera looks out across the track, a little down, the limb across the
 * top of the round window and the sun coming up just to its right.
 */

/** Where the camera looks: how far below level (degrees), and how far right of straight across the sun comes up (degrees). */
export const CAMERA = { pitch: 32, sun: 9 } as const

/** How long the ground photographs are along the track, in km: the scale they are drawn at. */
const STRIP = 1500
/** How far across the track the photographs' middles are, in km: what is under the round window. */
const ACROSS = 120
/** The shutter, in seconds of what the view shows: how long the ground is smeared for. */
const SHUTTER = 1 / 30

export interface Lens {
  /** The photograph's size, in its px, and how tall a view it takes in, in degrees. */
  width: number
  height: number
  fov: number
}

/** Where the plate stands on the screen, and where the canvas does, in CSS px; and the canvas's px to a CSS px. */
export interface Placing {
  plate: { left: number; top: number; scale: number }
  box: { x: number; y: number; w: number; h: number }
  dpr: number
}

export interface Moment {
  /** The ground gone by, in km; how many times faster than real the view runs; the sun's height above level, in radians. */
  ground: number
  lapse: number
  sun: number
}

export interface Earth {
  place: (placing: Placing) => void
  draw: (moment: Moment) => void
  /** Whether the graphics card has taken the canvas back: then nothing draws until the page is opened again. */
  lost: () => boolean
}

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

/** The sun's direction from the station, for its height above level: x along the track, y up, z across it, toward the camera's view. */
export const sunDirection = (height: number): [number, number, number] => {
  const az = (CAMERA.sun * Math.PI) / 180
  return [Math.cos(height) * Math.sin(az), Math.sin(height), Math.cos(height) * Math.cos(az)]
}

/** Where a direction from the station falls on the photograph, in its px. */
export function onPlate(lens: Lens, dir: [number, number, number]) {
  const p = (CAMERA.pitch * Math.PI) / 180
  const tanY = Math.tan((lens.fov * Math.PI) / 360)
  const aspect = lens.width / lens.height
  const [x, y, z] = dir
  // The camera's own axes: right along the track, forward down and across, up.
  const right = x
  const fwd = -y * Math.sin(p) + z * Math.cos(p)
  const up = y * Math.cos(p) + z * Math.sin(p)
  const nx = right / fwd / (tanY * aspect)
  const ny = up / fwd / tanY
  return { x: ((nx + 1) / 2) * lens.width, y: ((1 - ny) / 2) * lens.height }
}

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uBox;       // the canvas on the screen: x, y, height (CSS px), its px to a CSS px
uniform vec3 uPlate;     // the plate on the screen: left, top (CSS px), CSS px to a plate px
uniform vec2 uLensSize;  // the plate, in its px
uniform float uTanY, uPitch;
uniform float uGround, uSmear, uExposure, uSunVis, uRise, uAcross;
uniform int uTaps;
uniform vec3 uSun;
uniform vec2 uDayStrip, uNightStrip;
uniform sampler2D uDay, uNight;
out vec4 colour;
const float R = ${EARTH.radius.toFixed(1)}, H = ${EARTH.height.toFixed(1)};

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float jitter(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  // The pixel on the screen, then on the photograph, then through its lens.
  vec2 css = vec2(uBox.x + gl_FragCoord.x / uBox.w, uBox.y + uBox.z - gl_FragCoord.y / uBox.w);
  vec2 px = (css - uPlate.xy) / uPlate.z;
  vec2 n = vec2(px.x / uLensSize.x * 2.0 - 1.0, 1.0 - px.y / uLensSize.y * 2.0);
  float aspect = uLensSize.x / uLensSize.y;
  vec3 fwd = vec3(0.0, -sin(uPitch), cos(uPitch));
  vec3 up = vec3(0.0, cos(uPitch), sin(uPitch));
  vec3 d = normalize(fwd + vec3(1.0, 0.0, 0.0) * n.x * uTanY * aspect + up * n.y * uTanY);

  vec3 O = vec3(0.0, R + H, 0.0);
  vec3 S = normalize(uSun);
  float b = dot(O, d);
  float disc = b * b - (dot(O, O) - R * R);
  float toSun = max(dot(d, S), 0.0);
  vec3 c = vec3(0.0);

  if (disc > 0.0 && -b - sqrt(disc) > 0.0) {
    // The ground: where on the photographs, along the track and across it.
    vec3 P = O + (-b - sqrt(disc)) * d;
    vec3 N = P / R;
    float along = R * atan(P.x, P.y) + uGround;
    float across = R * asin(clamp(P.z / R, -1.0, 1.0)) - uAcross;
    float mu = dot(N, S);
    // The shutter: taps along the track, as far as the ground goes while it is open, jittered so they blend into a streak.
    vec3 day = vec3(0.0), night = vec3(0.0);
    float j = jitter(gl_FragCoord.xy);
    for (int i = 0; i < 16; i++) {
      if (i >= uTaps) break;
      float k = (float(i) + j) / float(uTaps) - 0.5;
      float a = along + k * uSmear;
      day += texture(uDay, vec2(a / uDayStrip.x, across / uDayStrip.y)).rgb;
      vec3 nl = texture(uNight, vec2(a / uNightStrip.x, across / uNightStrip.y)).rgb;
      // By night the land is near black and the clouds faintly moonlit and cool; the lights are what is left, and they are points, so brighter smeared than their pixel says.
      float lum = dot(nl, vec3(0.3, 0.5, 0.2));
      float lamp = smoothstep(0.12, 0.55, lum) * smoothstep(0.0, 0.25, nl.r - nl.b);
      night += mix(vec3(lum) * vec3(0.55, 0.65, 0.9), nl, 0.35) * 0.32 + nl * lamp * 5.0;
    }
    day /= float(uTaps);
    night /= float(uTaps);
    float lit = smoothstep(-0.02, 0.12, mu);
    vec3 low = mix(vec3(1.3, 0.7, 0.38), vec3(1.0), smoothstep(0.03, 0.3, mu));
    vec3 ground = day * lit * low * 1.1 + night * (1.0 - smoothstep(-0.06, 0.04, mu)) * 0.9;
    // Haze toward the limb: blue by day, near black by night, and the dawn's warmth along it toward the sun.
    float haze = clamp(1.0 - exp(-0.05 / max(dot(-d, N), 0.004)), 0.0, 1.0);
    vec3 air = mix(vec3(0.004, 0.008, 0.02), vec3(0.42, 0.6, 0.98), lit);
    air += vec3(1.0, 0.45, 0.16) * uRise * pow(toSun, 10.0) * smoothstep(0.6, 0.98, haze) * 0.9 * (1.0 - lit);
    c = mix(ground, air, haze);
  } else {
    // Above the limb: how near the ground the ray passes decides its glow.
    vec3 Pc = O - b * d;
    float alt = max(length(Pc) - R, 0.0);
    float day = smoothstep(-0.1, 0.1, dot(normalize(Pc), S));
    c += vec3(0.28, 0.52, 1.0) * exp(-alt / 18.0) * day * 1.4;
    c += vec3(0.6, 0.8, 1.0) * exp(-alt / 4.0) * day * 0.8;
    // The sunrise along the limb near the sun: red at the bottom, then orange, then blue.
    float near = pow(toSun, 3.0) * uRise;
    c += vec3(1.0, 0.28, 0.06) * exp(-alt / 5.0) * near * 3.0;
    c += vec3(1.0, 0.7, 0.3) * exp(-abs(alt - 14.0) / 6.0) * near * 1.6;
    c += vec3(0.25, 0.45, 1.0) * exp(-abs(alt - 32.0) / 12.0) * near * 1.2;
    // The airglow: a faint thin line high over the night side.
    c += vec3(0.25, 0.6, 0.3) * exp(-pow((alt - 95.0) / 5.0, 2.0)) * 0.035 * (1.0 - day);
    // The stars, put out by the light.
    vec3 cell = floor(d * 520.0);
    float star = step(0.9972, hash(cell)) * (0.3 + 1.6 * hash(cell + 7.1));
    c += vec3(star) * (1.0 - max(day, uSunVis)) * 0.5;
  }
  // The sun once it is clear of the limb: its disc and its glare.
  float a = acos(clamp(dot(d, S), -1.0, 1.0));
  c += vec3(1.0, 0.94, 0.82) * uSunVis * (smoothstep(0.0065, 0.0045, a) * 60.0 + exp(-a * 26.0) * 3.0 + exp(-a * 9.0) * 0.18);
  c = 1.0 - exp(-c * uExposure);
  colour = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`

/** The Earth on `canvas`, from the photographs of the ground by day and by night; null where the browser can't draw it. */
export function makeEarth(canvas: HTMLCanvasElement, lens: Lens, day: HTMLImageElement, night: HTMLImageElement): Earth | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
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

  const u = (name: string) => gl.getUniformLocation(program, name)
  const anisotropic = gl.getExtension('EXT_texture_filter_anisotropic')
  const texture = (img: HTMLImageElement, unit: number) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // Along the track the photograph repeats; across it, it is mirrored, so it runs on to the limb without a seam.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT)
    if (anisotropic) gl.texParameterf(gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, 8)
    gl.uniform1i(u(unit ? 'uNight' : 'uDay'), unit)
    return [STRIP, (STRIP * img.naturalHeight) / img.naturalWidth] as const
  }
  const dayStrip = texture(day, 0)
  const nightStrip = texture(night, 1)
  gl.uniform2f(u('uDayStrip'), ...dayStrip)
  gl.uniform2f(u('uNightStrip'), ...nightStrip)
  gl.uniform2f(u('uLensSize'), lens.width, lens.height)
  gl.uniform1f(u('uTanY'), Math.tan((lens.fov * Math.PI) / 360))
  gl.uniform1f(u('uPitch'), (CAMERA.pitch * Math.PI) / 180)
  gl.uniform1f(u('uAcross'), ACROSS)

  let lost = false
  canvas.addEventListener('webglcontextlost', () => (lost = true))

  return {
    place: ({ plate, box, dpr }) => {
      canvas.width = Math.max(1, Math.round(box.w * dpr))
      canvas.height = Math.max(1, Math.round(box.h * dpr))
      Object.assign(canvas.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` })
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform4f(u('uBox'), box.x, box.y, canvas.height / dpr, dpr)
      gl.uniform3f(u('uPlate'), plate.left, plate.top, plate.scale)
    },
    draw: ({ ground, lapse, sun }) => {
      if (lost) return
      const smear = EARTH.ground * lapse * SHUTTER
      // As many taps as the smear is texels long, up to sixteen: one at real speed.
      const texel = STRIP / day.naturalWidth
      gl.uniform1i(u('uTaps'), Math.min(16, Math.max(1, Math.ceil(smear / texel / 1.5))))
      gl.uniform1f(u('uGround'), ground)
      gl.uniform1f(u('uSmear'), smear)
      gl.uniform3f(u('uSun'), ...sunDirection(sun))
      const up = smooth(-DIP - 0.02, -DIP + 0.05, sun)
      // Exposed long by night, for the lights; shorter once the sun is up.
      gl.uniform1f(u('uExposure'), 1.9 - 0.75 * up)
      gl.uniform1f(u('uSunVis'), smooth(-DIP - 0.004, -DIP + 0.012, sun))
      gl.uniform1f(u('uRise'), smooth(-DIP - 0.1, -DIP, sun) * (1 - 0.6 * smooth(-DIP + 0.05, -DIP + 0.25, sun)))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    lost: () => lost,
  }
}

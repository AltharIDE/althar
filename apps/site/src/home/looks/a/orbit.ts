/*
 * Prototype, A: the night side of the planet from orbit, drawn on the
 * graphics card for every pixel of the window. A camera 400 km up looks out
 * at the horizon; under it the planet in its own shadow, its cities lit gold
 * under faint moonlit cloud, drifting past as the orbit carries it; over the
 * planet's edge the thin cobalt line of the air glowing in the dark, and the
 * stars. The sun is behind the planet: as it comes round to the edge, the
 * air there is lit by light that has passed through it sideways, blue high
 * up, orange and red low down, until the sun itself breaks over the edge.
 *
 * The air scatters light as air does (Rayleigh, and Mie for the haze, with
 * ozone taking out the orange high up), marched along each view ray; the
 * light's way to each point through the air is reckoned whole, by Schüler's
 * approximation of the Chapman function, so the twilight has no bands.
 */

export interface View {
  /** Seconds the ground has drifted for. */
  t: number
  /** The sun: its height over the camera's horizontal and its bearing to the right of straight ahead, in radians; and how strong it is (1, or less while dawn fades in with reduced motion). */
  sunElevation: number
  sunBearing: number
  sunPower: number
  /** How far toward dawn: the camera's exposure drops as the sun comes. */
  dawn: number
  /** How far the day's light has risen from the view's foot, at the end: 0 to 1, the footer's paper at the foot. */
  flood: number
  /** The camera's pitch (down is negative) and focal length in the canvas's px. */
  pitch: number
  focal: number
}

export interface Orbit {
  /** Sets the canvas's size, in its own px. */
  size: (w: number, h: number) => void
  draw: (view: View) => void
  /** The footer's paper, which the view's foot comes to as the day's light rises: sRGB, 0 to 1. */
  paper: (r: number, g: number, b: number) => void
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
uniform vec3 uSun;
uniform float uSunPower;
uniform float uDawn;
uniform float uFlood;
uniform vec3 uPaper;
uniform float uTime;

const float PI = 3.14159265;
// The planet, the top of its air and the camera, in km.
const float RP = 6360.0;
const float RA = 6420.0;
const float HC = 400.0;
// Air (Rayleigh) and haze (Mie): scattering per km at the ground, and scale heights.
const vec3 BR = vec3(5.8e-3, 13.5e-3, 33.1e-3);
const float BM = 21e-3;
const float HR = 8.0;
const float HM = 1.2;
const float G = 0.76;
// Ozone, taken with the air's column: it takes the orange out of light that has come a long way high up.
const vec3 BO = vec3(2.44e-3, 7.05e-3, 0.32e-3);
// The sun's strength, and its angular radius.
const float SUN = 22.0;
const float SUN_R = 0.0048;

vec2 sphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

// Schüler's Chapman approximation: the column along a ray to the edge of space, in scale heights; X is the planet's radius and h the point's height, in scale heights.
float chapman(float X, float h, float cosZ) {
  float c = sqrt(X + h);
  if (cosZ >= 0.0) return c * exp(-h) / (c * cosZ + 1.0);
  float x0 = sqrt(1.0 - cosZ * cosZ) * (X + h);
  float c0 = sqrt(x0);
  return 2.0 * c0 * exp(min(X - x0, 60.0)) - c * exp(-h) / (1.0 - c * cosZ);
}

// What reaches a point at radius r of the sun's light, through the air, and whether the planet is in the way.
vec3 sunlight(vec3 p) {
  float r = length(p);
  float h = max(r - RP, 0.0);
  float cosZ = dot(p / r, uSun);
  float seen = 1.0;
  if (cosZ < 0.0) {
    float tangent = r * sqrt(1.0 - cosZ * cosZ) - RP;
    seen = smoothstep(-0.5, 2.5, tangent);
  }
  if (seen <= 0.0) return vec3(0.0);
  float odR = HR * chapman(RP / HR, h / HR, cosZ);
  float odM = HM * chapman(RP / HM, h / HM, cosZ);
  return seen * exp(-(BR * odR + BO * odR + BM * 1.1 * odM));
}

// ---- noise ----
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

// ---- the ground at night: towns in gold, under cloud ----
// One layer of towns: a light in some cells of a grid on the planet, each a soft point, widened (and dimmed to keep its light) where a pixel is larger than it; a town fades in and out, never pops, as how many are lit changes across the window.
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
// The towns, by how near the ground is (1 at the window's foot, 0 at the edge): near, more of them and gold; far, fewer, and reddened by the air.
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
  // Sprawl: the glow of the towns' own light where they are thickest, and the roads between.
  float sprawl = urban * urban * smoothstep(0.5, 0.85, fbm(n * 90.0, 3, foot * 90.0));
  lights += sprawl * 0.6 + urban * urban * 0.09;
  cloud = smoothstep(0.52, 0.78, fbm(n * 5.5 + vec3(2.0, 9.0, 4.0), 5, foot * 5.5));
  vec3 gold = mix(vec3(1.0, 0.6, 0.26), vec3(1.0, 0.82, 0.56), hash13(floor(n * 260.0)) * near);
  vec3 sodium = mix(vec3(1.0, 0.4, 0.14), gold, smoothstep(0.0, 0.7, near));
  return sodium * lights * (1.0 - 0.88 * cloud);
}

// ---- the sky ----
// The stars by the face of a cube round the camera, so each star is whole within its cell.
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
  // Distance in pixels: a cell is 1/scale across the face, about that in radians near its middle.
  float dist = length(c - at) / scale * px;
  float m = bright * (0.035 + pow(hash13(vec3(cell, face + salt + 3.0)), 5.0) * 1.4);
  float tint = hash13(vec3(cell, face + salt + 9.0));
  vec3 col = tint < 0.14 ? vec3(0.75, 0.85, 1.0) : tint > 0.9 ? vec3(1.0, 0.86, 0.7) : vec3(1.0);
  return col * m * exp(-dist * dist / 0.5);
}
vec3 stars(vec3 d, float px) {
  // The galaxy's band, faint, across the sky.
  vec3 gn = normalize(vec3(0.42, 0.78, -0.46));
  float band = exp(-pow(dot(d, gn) / 0.2, 2.0));
  float dust = fbm(d * 6.0, 4, 0.0);
  vec3 glow = vec3(0.85, 0.88, 1.0) * band * smoothstep(0.35, 0.75, dust) * 0.004;
  vec3 s = starLayer(d, 24.0, 0.3, 1.0, 0.0, px);
  s += starLayer(d, 60.0, 0.12, 0.5, 5.0, px);
  s += starLayer(d, 150.0, 0.3 * band * smoothstep(0.4, 0.7, dust), 0.35, 11.0, px);
  return s + glow;
}


vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uFocal;
  float sp = sin(uPitch), cp = cos(uPitch);
  vec3 fw = vec3(0.0, sp, cp);
  vec3 rt = vec3(1.0, 0.0, 0.0);
  vec3 up = vec3(0.0, cp, -sp);
  vec3 rd = normalize(fw + uv.x * rt + uv.y * up);
  vec3 ro = vec3(0.0, RP + HC, 0.0);
  // A pixel's width in radians.
  float px = 1.0 / uFocal;

  vec2 hitP = sphere(ro, rd, RP);
  bool ground = hitP.x > 0.0;
  float tEnd = ground ? hitP.x : 1e9;

  // ---- the air: marched more finely where it is thickest, at the ray's closest pass or its foot ----
  vec3 inscatter = vec3(0.0);
  vec3 trans = vec3(1.0);
  vec2 hitA = sphere(ro, rd, RA);
  float mu = dot(rd, uSun);
  if (hitA.y > 0.0) {
    float t0 = max(hitA.x, 0.0);
    float t1 = min(hitA.y, tEnd);
    float tc = clamp(-dot(ro, rd), t0, t1);
    float g2 = G * G;
    float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float phM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * G * mu, 1e-4), 1.5));
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    float odR = 0.0, odM = 0.0;
    const int N = 18;
    for (int side = 0; side < 2; side++) {
      float a = side == 0 ? t0 : tc;
      float b = side == 0 ? tc : t1;
      float len = b - a;
      if (len <= 0.0) continue;
      for (int i = 0; i < N; i++) {
        // Toward the closest pass, the steps shorten.
        float u0 = float(i) / float(N), u1 = float(i + 1) / float(N);
        float s0 = side == 0 ? 1.0 - (1.0 - u0) * (1.0 - u0) : u0 * u0;
        float s1 = side == 0 ? 1.0 - (1.0 - u1) * (1.0 - u1) : u1 * u1;
        float t = a + len * 0.5 * (s0 + s1);
        float dt = len * (s1 - s0);
        vec3 p = ro + rd * t;
        float h = length(p) - RP;
        float dR = exp(-h / HR) * dt;
        float dM = exp(-h / HM) * dt;
        odR += dR * 0.5;
        odM += dM * 0.5;
        vec3 tv = exp(-(BR * odR + BO * odR + BM * 1.1 * odM));
        vec3 ls = sunlight(p);
        sumR += dR * tv * ls;
        sumM += dM * tv * ls;
        odR += dR * 0.5;
        odM += dM * 0.5;
      }
    }
    trans = exp(-(BR * odR + BO * odR + BM * 1.1 * odM));
    inscatter = SUN * uSunPower * (sumR * BR * phR + sumM * BM * phM);
    // The camera's eye on the dawn: the light gathers toward the sun, the far ends of the arc fainter.
    inscatter *= 0.42 + 0.58 * exp(-acos(clamp(mu, -1.0, 1.0)) * 3.2);
  }

  // ---- what the camera is looking at, and the camera's exposure for it ----
  float exposure = mix(2.4, 0.62, uDawn * uDawn);
  vec3 col = vec3(0.0);
  vec3 sunUp = normalize(ro);
  // How far the sun stands over the planet's edge as the camera sees it, in radians.
  float overEdge = acos(clamp(-dot(uSun, sunUp), -1.0, 1.0)) - asin(RP / (RP + HC));

  if (ground) {
    vec3 p = ro + rd * hitP.x;
    vec3 n = p / RP;
    // The ground turns under the orbit: about the line straight ahead, so it drifts across the window.
    float a = uTime * 2.0e-3;
    float ca = cos(a), sa = sin(a);
    vec3 m = vec3(ca * n.x - sa * n.y, sa * n.x + ca * n.y, n.z);
    // A pixel's size on the ground, as a share of the planet's radius, foreshortened toward the edge.
    float slant = max(dot(n, -rd), 0.06);
    float foot = hitP.x * px / RP / sqrt(slant);
    float cloud;
    float near = 1.0 - smoothstep(500.0, 2100.0, hitP.x);
    vec3 lights = night(m, foot, near, cloud);
    // Towns go out as the ground comes into twilight.
    float sunZ = dot(n, uSun);
    float dark = smoothstep(0.05, -0.12, sunZ);
    col = lights * mix(0.12, 0.36, near) * dark;
    // The cloud, faint under the moon.
    col += vec3(0.55, 0.62, 0.8) * cloud * 0.0035;
    // Where the sun has come up: sea and cloud in its light.
    vec3 sl = sunlight(p + n * 0.5);
    col += SUN * uSunPower * sl * max(sunZ, 0.0) * (0.035 + 0.55 * cloud) / PI;
    col *= trans;
  } else {
    // The sun itself, its glare and its rays, as the edge lets it be seen.
    float ang = acos(clamp(mu, -1.0, 1.0));
    float shown = smoothstep(-SUN_R, SUN_R * 1.2, overEdge) * uSunPower;
    vec3 through = sunlight(ro);
    col += stars(rd, uFocal) * trans * (1.0 - 0.85 * uDawn);
    col += through * shown * smoothstep(SUN_R + px, SUN_R - px, ang) * 60.0;
  }

  // The sun's glare in the lens, over everything, as much as the sun shows.
  {
    float ang = acos(clamp(mu, -1.0, 1.0));
    float shown = smoothstep(-SUN_R * 3.0, SUN_R * 1.5, overEdge) * uSunPower;
    vec3 warm = sunlight(ro) * vec3(1.0, 0.92, 0.82);
    // A hot bloom round the sun, and its light spread wide in the lens.
    float glare = exp(-ang * 320.0) * 7.0 + exp(-ang * 60.0) * 1.6 + exp(-ang * 14.0) * 0.38 + exp(-ang * 4.0) * 0.09;
    glare *= 1.0 + 5.0 * uFlood;
    // Six short faint rays, from the lens's blades.
    vec2 sUv = vec2(dot(uSun, rt), dot(uSun, up)) / max(dot(uSun, fw), 1e-3);
    vec2 dv = uv - sUv;
    float phi = atan(dv.y, dv.x);
    float rays = pow(abs(cos(3.0 * (phi - 0.2))), 220.0) * exp(-length(dv) * 26.0) * 0.35;
    col += warm * shown * (glare + rays);
  }

  col += inscatter;

  // The edge lit cobalt, the site's one light over the night: by how high over the edge the ray passes (below it, over the planet, how far inside), a fine bright line hugging the edge, its glow, and a wide faint haze over it.
  {
    float tc = -dot(ro, rd);
    float over = length(ro + rd * max(tc, 0.0)) - RP;
    float line = exp(-pow((over - 2.5) / 2.0, 2.0));
    float halo = exp(-max(over, 0.0) / 13.0) * smoothstep(-4.0, 1.0, over);
    float haze = exp(-max(over, 0.0) / 95.0) * smoothstep(-2.0, 3.0, over);
    vec3 glow = vec3(0.6, 0.65, 1.0) * line * 0.17 + vec3(0.13, 0.18, 1.0) * halo * 0.05 + vec3(0.05, 0.08, 1.0) * haze * 0.012;
    // The dawn's own light outshines it.
    col += glow * (1.0 - 0.6 * uDawn);
  }

  // At the end, the day's light rises from the view's foot, warm, peach at its edge and cream below, steep enough at its edge that the night over it stays the night's and nothing between is muddied.
  float foot = gl_FragCoord.y / uRes.y;
  float rise = exp(-pow(foot / 0.19, 1.4)) * uFlood;
  col += mix(vec3(1.0, 0.74, 0.58), vec3(1.0, 0.95, 0.89), rise) * rise * 7.0;
  col *= exposure;
  vec3 mapped = aces(col);
  // A little warmth in the highlights, as the first screen's film has.
  float lum = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  mapped = mix(mapped, mapped * vec3(1.035, 1.0, 0.94), smoothstep(0.45, 1.0, lum));
  vec3 srgb = pow(mapped, vec3(1.0 / 2.2));
  // Dither, so the dark gradients never band.
  srgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  // Its last rows are the footer's paper itself, so the view meets it with no seam.
  srgb = mix(srgb, uPaper, (1.0 - smoothstep(0.0, 0.09, foot)) * uFlood);
  color = vec4(srgb, 1.0);
}`

export function makeOrbit(canvas: HTMLCanvasElement, lost: () => void): Orbit | null {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
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
      console.warn(
        'orbit: the shader did not compile',
        type === gl.VERTEX_SHADER ? 'vertex' : 'fragment',
        gl.getShaderInfoLog(shader),
        gl.isContextLost(),
      )
      return null
    }
    return shader
  }
  const vs = compile(gl.VERTEX_SHADER, VERTEX)
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(program))
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
  const uRes = u('uRes'),
    uFocal = u('uFocal'),
    uPitch = u('uPitch'),
    uSun = u('uSun'),
    uSunPower = u('uSunPower'),
    uDawn = u('uDawn'),
    uFlood = u('uFlood'),
    uPaper = u('uPaper'),
    uTime = u('uTime')

  // The page's paper until the footer's own is known.
  gl.uniform3f(uPaper, 244 / 255, 242 / 255, 236 / 255)

  const lose = (event: Event) => {
    event.preventDefault()
    lost()
  }
  canvas.addEventListener('webglcontextlost', lose)

  return {
    size: (w, h) => {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
    },
    paper: (r, g, b) => {
      gl.uniform3f(uPaper, r, g, b)
    },
    draw: (v) => {
      if (gl.isContextLost()) return
      const ce = Math.cos(v.sunElevation)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uFocal, v.focal)
      gl.uniform1f(uPitch, v.pitch)
      gl.uniform3f(uSun, ce * Math.sin(v.sunBearing), Math.sin(v.sunElevation), ce * Math.cos(v.sunBearing))
      gl.uniform1f(uSunPower, v.sunPower)
      gl.uniform1f(uDawn, v.dawn)
      gl.uniform1f(uFlood, v.flood)
      gl.uniform1f(uTime, v.t)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose: () => {
      canvas.removeEventListener('webglcontextlost', lose)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

/** The planet's edge as the camera sees it: how far below the horizontal, in radians. */
export const EDGE_DIP = Math.acos(6360 / 6760)

import { type Mesh, point, solid } from './solid'

/*
 * The sun on the graphics card: the mark as a solid (solid.ts), the point a
 * small cobalt light in its bore, lit from the upper left with cobalt from
 * behind on the edges turned away, as the night lights them; seen from a
 * little above, as the orbits are, through a narrow lens so the perspective
 * is gentle. It sways slowly about its upright and bobs. WebGL 2, with
 * nothing kept between frames, so a frame is one clear and two draws.
 */

/** How the sun sits: turned about its upright, tipped toward you, rolled a hair, in radians; and how high it floats, in grid units. */
export interface Pose {
  yaw: number
  pitch: number
  roll: number
  lift: number
}

const TAU = 2 * Math.PI

/** Its pose at second `t`, tipped toward you as far as the orbits are seen from above (`tilt`): slow, out of step, so it never quite repeats. */
export const pose = (t: number, tilt: number): Pose => ({
  yaw: 0.46 * Math.sin((TAU * t) / 19) + 0.1 * Math.sin((TAU * t) / 7.7 + 1.3),
  pitch: tilt + 0.05 * Math.sin((TAU * t) / 11 + 0.4),
  roll: 0.035 * Math.sin((TAU * t) / 13 + 2.1),
  lift: 0.55 * Math.sin((TAU * t) / 6.4),
})

/** The pose it holds with reduced motion: a quarter turned, so it reads as a solid. */
export const rest = (tilt: number): Pose => ({ yaw: -0.38, pitch: tilt, roll: 0, lift: 0 })

/** The canvas round the mark, in the mark's sizes: room for it to turn and bob. */
export const ROOM = 2.3
/** The lens: narrow, so the perspective is gentle. */
const FOV = (16 * Math.PI) / 180

/** The piece's colour, cream as the flat mark is; the point's, cobalt, and how much it is its own light. */
const CREAM = [1, 0.968, 0.93] as const
const COBALT = [0.5, 0.545, 1] as const
const POINT_GLOW = 0.72

const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNrm;
uniform mat4 uModel;
uniform mat4 uProj;
uniform vec3 uAt;
out vec3 vN;
out vec3 vP;
void main() {
  vec4 p = uModel * vec4(aPos, 1.0);
  p.xyz += uAt;
  vN = mat3(uModel) * aNrm;
  vP = p.xyz;
  gl_Position = uProj * p;
}`

const FRAG = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vP;
uniform vec3 uAlbedo;
uniform float uGlow;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(-vP);
  // The key light from the upper left, a little in front; cobalt from behind, below right, as the night's lit edge.
  vec3 key = normalize(vec3(-0.38, 0.5, 0.8));
  vec3 rim = normalize(vec3(0.62, -0.42, -0.45));
  float d1 = max(dot(n, key), 0.0);
  float d2 = max(dot(n, rim), 0.0);
  float sp = pow(max(dot(n, normalize(key + v)), 0.0), 56.0);
  float fr = pow(1.0 - max(dot(n, v), 0.0), 2.4);
  vec3 cobalt = vec3(0.42, 0.48, 1.0);
  vec3 c = uAlbedo * (0.4 + 0.66 * d1) + cobalt * (0.55 * d2 + 0.32 * fr) + vec3(1.0, 0.96, 0.9) * sp * 0.55;
  o = vec4(mix(c, uAlbedo, uGlow), 1.0);
}`

type M4 = Float32Array

const multiply = (a: M4, b: M4): M4 => {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!
  return o
}
const rotX = (t: number) => new Float32Array([1, 0, 0, 0, 0, Math.cos(t), Math.sin(t), 0, 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 0, 1])
const rotY = (t: number) => new Float32Array([Math.cos(t), 0, -Math.sin(t), 0, 0, 1, 0, 0, Math.sin(t), 0, Math.cos(t), 0, 0, 0, 0, 1])
const rotZ = (t: number) => new Float32Array([Math.cos(t), Math.sin(t), 0, 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const perspective = (fov: number, near: number, far: number) => {
  const f = 1 / Math.tan(fov / 2)
  return new Float32Array([f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0])
}

/** The sun's model matrix for a pose: tipped, then turned, then rolled. */
export const modelOf = (q: Pose) => multiply(rotX(q.pitch), multiply(rotY(q.yaw), rotZ(q.roll)))

/** The two meshes, made once for the page. */
let meshes: { piece: Mesh; ball: Mesh } | null = null
const meshesNow = () => (meshes ??= { piece: solid(), ball: point() })

function compile(gl: WebGL2RenderingContext) {
  const made: WebGLShader[] = []
  const shader = (type: number, src: string) => {
    const sh = gl.createShader(type)
    if (!sh) throw new Error('No shader')
    made.push(sh)
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'The shader failed to compile')
    return sh
  }
  const prog = gl.createProgram()
  try {
    if (!prog) throw new Error('No program')
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'The program failed to link')
    return prog
  } catch (error) {
    if (prog) gl.deleteProgram(prog)
    throw error
  } finally {
    // Linked, the program keeps what it needs of them.
    for (const sh of made) gl.deleteShader(sh)
  }
}

function upload(gl: WebGL2RenderingContext, prog: WebGLProgram, mesh: Mesh) {
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW)
  const pos = gl.getAttribLocation(prog, 'aPos')
  const nrm = gl.getAttribLocation(prog, 'aNrm')
  gl.enableVertexAttribArray(pos)
  gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 24, 0)
  gl.enableVertexAttribArray(nrm)
  gl.vertexAttribPointer(nrm, 3, gl.FLOAT, false, 24, 12)
  const idx = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW)
  gl.bindVertexArray(null)
  return {
    vao,
    count: mesh.index.length,
    drop: () => {
      gl.deleteVertexArray(vao)
      gl.deleteBuffer(buf)
      gl.deleteBuffer(idx)
    },
  }
}

export interface SunGl {
  /** Fits the canvas to `css` px square at `dpr` device px to each. */
  size(css: number, dpr: number): void
  draw(q: Pose): void
  /** Gives back what it holds on the card. */
  drop(): void
}

/** The sun on `canvas`'s WebGL 2 context; null where there is none, or it can't draw (the hero shows the flat mark then). */
export function makeSun(canvas: HTMLCanvasElement): SunGl | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    depth: true,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'low-power',
  })
  if (!gl || gl.isContextLost()) return null
  let prog: WebGLProgram
  try {
    prog = compile(gl)
  } catch {
    return null
  }
  const { piece: pieceMesh, ball: ballMesh } = meshesNow()
  const piece = upload(gl, prog, pieceMesh)
  const ball = upload(gl, prog, ballMesh)
  const at = {
    model: gl.getUniformLocation(prog, 'uModel'),
    proj: gl.getUniformLocation(prog, 'uProj'),
    shift: gl.getUniformLocation(prog, 'uAt'),
    albedo: gl.getUniformLocation(prog, 'uAlbedo'),
    glow: gl.getUniformLocation(prog, 'uGlow'),
  }
  // Far enough that the mark's 24 grid is the size asked for where it stands; the canvas is ROOM of it across.
  const dist = (ROOM * 12) / Math.tan(FOV / 2)
  gl.useProgram(prog)
  gl.uniformMatrix4fv(at.proj, false, perspective(FOV, dist - 30, dist + 30))
  gl.enable(gl.DEPTH_TEST)
  // Every triangle turns outward (solid.ts), so the faces turned away needn't be drawn.
  gl.enable(gl.CULL_FACE)
  gl.clearColor(0, 0, 0, 0)

  return {
    size(css, dpr) {
      const px = Math.max(1, Math.round(css * dpr))
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px
        canvas.height = px
      }
      gl.viewport(0, 0, px, px)
    },
    draw(q) {
      if (gl.isContextLost()) return
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.uniformMatrix4fv(at.model, false, modelOf(q))
      gl.uniform3f(at.shift, 0, q.lift, -dist)
      gl.uniform3f(at.albedo, ...CREAM)
      gl.uniform1f(at.glow, 0)
      gl.bindVertexArray(piece.vao)
      gl.drawElements(gl.TRIANGLES, piece.count, gl.UNSIGNED_SHORT, 0)
      gl.uniform3f(at.albedo, ...COBALT)
      gl.uniform1f(at.glow, POINT_GLOW)
      gl.bindVertexArray(ball.vao)
      gl.drawElements(gl.TRIANGLES, ball.count, gl.UNSIGNED_SHORT, 0)
      gl.bindVertexArray(null)
    },
    drop() {
      if (gl.isContextLost()) return
      piece.drop()
      ball.drop()
      gl.deleteProgram(prog)
    },
  }
}

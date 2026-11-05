import { LOGO_BORE, LOGO_SECTION } from '@althar/ui'
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'

import { type Mesh, point, solid } from './night/solid'
import s from './Sun.module.css'

/*
 * Prototype: the Orrery's sun, the mark as a thing floating in the middle
 * of the system, two ways.
 *
 * 3D: the mark's section drawn out into a solid piece, the bore through it
 * and the point a small cobalt light in the bore; lit from the upper left,
 * cobalt from behind on the edges turned away, seen from a little above as
 * the orbits are. Drawn on the graphics card; it sways slowly about its
 * upright and bobs.
 *
 * 2.5D: flat planes in depth, as a pop-up print: the mark's face, a thin
 * edge under it, a cobalt plate of the same cut far behind, the point
 * floating in front of the bore. The planes tilt together and slide against
 * each other.
 *
 * With reduced motion (or `?t=`), both hold at one tilt.
 */

export type SunKind = '3D' | '2.5D'

interface Props {
  kind: SunKind
  /** The bore's place in the frame, and the mark's size (its 24 grid), in CSS px. */
  cx: number
  cy: number
  size: number
  still: boolean
}

export function Sun({ kind, cx, cy, size, still }: Props) {
  const [failed, setFailed] = useState(false)
  if (kind === '3D' && !failed) return <Solid cx={cx} cy={cy} size={size} still={still} onFail={setFailed} />
  return <Planes cx={cx} cy={cy} size={size} still={still} />
}

/* ---- 2.5D ---- */

/** The edge's planes, front to back. */
const EDGE = [1, 2, 3, 4, 5, 6, 7, 8]

function Planes({ cx, cy, size, still }: Omit<Props, 'kind'>) {
  const k = size / 24
  return (
    <div
      className={s.planes}
      data-still={still ? '' : undefined}
      aria-hidden="true"
      style={{ left: cx - 12 * k, top: cy - 14.4 * k, width: size, height: size, '--k': k } as CSSProperties}
    >
      <div className={s.bob}>
        <div className={s.sway}>
          <svg className={s.ghost} viewBox="0 0 24 24">
            <path d={LOGO_SECTION + LOGO_BORE} fillRule="evenodd" />
          </svg>
          {EDGE.map((i) => (
            <svg key={i} className={s.edge} viewBox="0 0 24 24" style={{ '--i': i } as CSSProperties}>
              <path d={LOGO_SECTION + LOGO_BORE} fillRule="evenodd" />
            </svg>
          ))}
          <svg className={s.face} viewBox="0 0 24 24">
            <defs>
              <linearGradient id="sun-face" x1="0.2" y1="0.1" x2="0.8" y2="0.95">
                <stop offset="0" stopColor="#fffbf4" />
                <stop offset="1" stopColor="#e9dfd1" />
              </linearGradient>
            </defs>
            <path d={LOGO_SECTION + LOGO_BORE} fillRule="evenodd" fill="url(#sun-face)" />
          </svg>
          <i className={s.point} />
        </div>
      </div>
    </div>
  )
}

/* ---- 3D ---- */

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

/** The canvas round the mark, in the mark's sizes: room for it to turn and bob. */
const ROOM = 2.3
/** The camera's field of view: narrow, so the perspective is gentle. */
const FOV = (16 * Math.PI) / 180

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

/** How it sways at second `t`: turned about its upright, tipped toward you (seen from above, as the orbits are), rolled a hair; and how high it floats, in grid units. */
const pose = (t: number) => {
  const tau = 2 * Math.PI
  return {
    yaw: 0.46 * Math.sin((tau * t) / 19) + 0.1 * Math.sin((tau * t) / 7.7 + 1.3),
    pitch: 0.22 + 0.05 * Math.sin((tau * t) / 11 + 0.4),
    roll: 0.035 * Math.sin((tau * t) / 13 + 2.1),
    lift: 0.55 * Math.sin((tau * t) / 6.4),
  }
}
/** The pose it holds at with reduced motion: a quarter turned, so it reads as a solid. */
const HELD = { yaw: -0.38, pitch: 0.22, roll: 0, lift: 0 }

function compile(gl: WebGL2RenderingContext) {
  const shader = (type: number, src: string) => {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
    return sh
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link')
  return prog
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

function Solid({ cx, cy, size, still, onFail }: Omit<Props, 'kind'> & { onFail: (failed: true) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = size * ROOM

  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    const gl = el.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true })
    if (!gl) return onFail(true)
    let prog: WebGLProgram
    try {
      prog = compile(gl)
    } catch {
      return onFail(true)
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    el.width = Math.round(box * dpr)
    el.height = Math.round(box * dpr)
    gl.viewport(0, 0, el.width, el.height)
    gl.enable(gl.DEPTH_TEST)
    gl.clearColor(0, 0, 0, 0)
    const piece = upload(gl, prog, solid())
    const ball = upload(gl, prog, point())
    const at = {
      model: gl.getUniformLocation(prog, 'uModel'),
      proj: gl.getUniformLocation(prog, 'uProj'),
      shift: gl.getUniformLocation(prog, 'uAt'),
      albedo: gl.getUniformLocation(prog, 'uAlbedo'),
      glow: gl.getUniformLocation(prog, 'uGlow'),
    }
    // Far enough that the mark's 24 grid is `size` px across where it stands.
    const half = (ROOM * 24) / 2
    const dist = half / Math.tan(FOV / 2)
    gl.useProgram(prog)
    gl.uniformMatrix4fv(at.proj, false, perspective(FOV, dist - 30, dist + 30))

    const draw = (q: typeof HELD) => {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      const model = multiply(rotX(q.pitch), multiply(rotY(q.yaw), rotZ(q.roll)))
      gl.uniformMatrix4fv(at.model, false, model)
      gl.uniform3f(at.shift, 0, q.lift, -dist)
      // The piece, cream, as the flat mark is; the point, cobalt, a light of its own.
      gl.uniform3f(at.albedo, 1, 0.968, 0.93)
      gl.uniform1f(at.glow, 0)
      gl.bindVertexArray(piece.vao)
      gl.drawElements(gl.TRIANGLES, piece.count, gl.UNSIGNED_SHORT, 0)
      gl.uniform3f(at.albedo, 0.5, 0.545, 1)
      gl.uniform1f(at.glow, 0.72)
      gl.bindVertexArray(ball.vao)
      gl.drawElements(gl.TRIANGLES, ball.count, gl.UNSIGNED_SHORT, 0)
    }

    const drop = () => {
      piece.drop()
      ball.drop()
      gl.deleteProgram(prog)
    }
    if (still) {
      draw(HELD)
      return drop
    }
    // Its own clock, running only while it is on screen.
    let frame = 0
    let t = 0
    let last = 0
    let shown = true
    const tick = (now: number) => {
      t += Math.min(0.1, last ? (now - last) / 1000 : 0)
      last = now
      draw(pose(t))
      frame = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver(([entry]) => {
      const on = entry?.isIntersecting ?? true
      if (on === shown) return
      shown = on
      cancelAnimationFrame(frame)
      last = 0
      if (on) frame = requestAnimationFrame(tick)
    })
    io.observe(el)
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      drop()
    }
  }, [box, still, onFail])

  return (
    <canvas
      ref={canvas}
      className={s.solid}
      aria-hidden="true"
      style={{ left: cx - box / 2, top: cy - box / 2, width: box, height: box }}
    />
  )
}

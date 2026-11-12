import { assert, describe, it } from '@effect/vitest'

import {
  CANVAS_LIMITS,
  canvasAddress,
  canvasAddressOf,
  canvasHost,
  canvasKindOf,
  canvasMediaTypeOf,
  canvasPartitionOf,
  isCanvasName,
  isReservedCanvasPath,
  manifestBytes,
} from '../src/canvases'

/*
 * What every side reads of a canvas the same way (ADR-104): its name, how its
 * entry is drawn, what its files are served as, its manifest's bytes, and the
 * address a version's file has, under the canvas's own origin.
 */

const ID = 'cnv_0193a1b2c3d4e5f60718293a4b5c6d7e'

describe('a canvas', () => {
  it('is named in lowercase words and hyphens, as an agent and the person say it', () => {
    assert.isTrue(isCanvasName('login-flow'))
    assert.isTrue(isCanvasName('v2'))
    for (const name of ['', 'Login', 'login_flow', '-login', 'login-', 'login--flow', 'a b', 'x'.repeat(CANVAS_LIMITS.name + 1)])
      assert.isFalse(isCanvasName(name), name)
  })

  it('is drawn by its entry’s kind, and an entry Althar can’t draw has none', () => {
    assert.strictEqual(canvasKindOf('notes/README.md'), 'markdown')
    assert.strictEqual(canvasKindOf('flow.MMD'), 'mermaid')
    assert.strictEqual(canvasKindOf('logo.svg'), 'svg')
    for (const picture of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp']) assert.strictEqual(canvasKindOf(picture), 'picture')
    assert.strictEqual(canvasKindOf('index.html'), 'html')
    assert.strictEqual(canvasKindOf('index.htm'), 'html')
    assert.strictEqual(canvasKindOf('app.js'), null)
    assert.strictEqual(canvasKindOf('README'), null)
  })

  it('serves its files by their extension, and anything else as bytes', () => {
    assert.strictEqual(canvasMediaTypeOf('index.html'), 'text/html; charset=utf-8')
    assert.strictEqual(canvasMediaTypeOf('chart.JS'), 'text/javascript; charset=utf-8')
    assert.strictEqual(canvasMediaTypeOf('logo.svg'), 'image/svg+xml')
    assert.strictEqual(canvasMediaTypeOf('font.woff2'), 'font/woff2')
    assert.strictEqual(canvasMediaTypeOf('data.bin'), 'application/octet-stream')
  })

  it('keeps `.althar/` inside it for Althar', () => {
    assert.isTrue(isReservedCanvasPath('.althar'))
    assert.isTrue(isReservedCanvasPath('.althar/tokens.css'))
    assert.isFalse(isReservedCanvasPath('althar/x'))
    assert.isFalse(isReservedCanvasPath('.altharx'))
  })

  it('has one manifest’s bytes for the same files, in whatever order they were read', () => {
    const a = { path: 'a.css', sha256: 'a'.repeat(64), size: 1, type: 'text/css' }
    const b = { path: 'index.html', sha256: 'b'.repeat(64), size: 2, type: 'text/html' }
    const one = new TextDecoder().decode(manifestBytes({ entry: 'index.html', files: [b, a] }))
    const two = new TextDecoder().decode(manifestBytes({ entry: 'index.html', files: [a, b] }))
    assert.strictEqual(one, two)
    assert.deepStrictEqual(JSON.parse(one), { entry: 'index.html', files: [a, b] })
  })
})

describe('a version’s address', () => {
  it('is under the canvas’s own origin, with the version as its path', () => {
    assert.strictEqual(canvasHost(ID), '0193a1b2c3d4e5f60718293a4b5c6d7e')
    assert.strictEqual(canvasAddress(ID, 3, 'index.html'), 'althar-canvas://0193a1b2c3d4e5f60718293a4b5c6d7e/v3/index.html')
    assert.strictEqual(canvasAddress(ID, 1, 'pics/a b#.png'), 'althar-canvas://0193a1b2c3d4e5f60718293a4b5c6d7e/v1/pics/a%20b%23.png')
  })

  it('reads back as what it names, and anything else as nothing', () => {
    assert.deepStrictEqual(canvasAddressOf(canvasAddress(ID, 12, 'pics/a b#.png')), {
      host: '0193a1b2c3d4e5f60718293a4b5c6d7e',
      version: 12,
      path: 'pics/a b#.png',
    })
    assert.deepStrictEqual(canvasAddressOf('althar-canvas://0193a1b2c3d4e5f60718293a4b5c6d7e/v2/'), {
      host: '0193a1b2c3d4e5f60718293a4b5c6d7e',
      version: 2,
      path: '',
    })
    for (const address of [
      'not an address',
      'https://0193a1b2c3d4e5f60718293a4b5c6d7e/v1/index.html',
      'althar-canvas://nothex/v1/index.html',
      'althar-canvas://0193a1b2c3d4e5f60718293a4b5c6d7e/index.html',
      'althar-canvas://0193a1b2c3d4e5f60718293a4b5c6d7e/v0/index.html',
      'althar-canvas://0193a1b2c3d4e5f60718293a4b5c6d7e/v1/%E0%A4%A.png',
    ])
      assert.isNull(canvasAddressOf(address), address)
  })

  it('is served in a partition of its project’s canvases, apart from its pages', () => {
    assert.strictEqual(canvasPartitionOf('proj_0193a1b2c3d4e5f60718293a4b5c6d7e'), 'persist:canvases-0193a1b2c3d4e5f60718293a4b5c6d7e')
  })
})

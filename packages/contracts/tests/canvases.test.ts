import { assert, describe, it } from '@effect/vitest'

import {
  BOARDS_ENTRY,
  BOARDS_LIMITS,
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
  readBoards,
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

describe('a canvas of boards', () => {
  const has = (path: string) => path !== 'missing.html'
  const board = { name: 'Home', file: 'home.html', width: 1440, height: 900 }
  const read = (said: unknown) => readBoards(typeof said === 'string' ? said : JSON.stringify(said), has)
  const why = (said: unknown) => {
    const got = read(said)
    assert.isFalse(got.ok)
    return got.ok ? '' : got.why
  }
  const on = (b: unknown) => ({ pages: [{ name: 'a', boards: [b] }] })

  it('is drawn by its entry, canvas.json', () => {
    assert.strictEqual(canvasKindOf(BOARDS_ENTRY), 'boards')
  })

  it('reads pages with their boards, trimming names and a leading ./ on files', () => {
    const got = read({ pages: [{ name: ' Main ', boards: [{ ...board, name: ' Home ', file: './home.html' }] }] })
    assert.deepStrictEqual(got, { ok: true, boards: { pages: [{ name: 'Main', boards: [board] }] } })
  })

  it('reads a single page written as its boards alone, named Page 1 unless it says', () => {
    const one = (name: string) => ({ ok: true as const, boards: { pages: [{ name, boards: [board] }] } })
    assert.deepStrictEqual(read({ boards: [board] }), one('Page 1'))
    assert.deepStrictEqual(read({ name: 'Login', boards: [board] }), one('Login'))
    assert.deepStrictEqual(read({ name: '  ', boards: [board] }), one('Page 1'))
    assert.deepStrictEqual(read({ name: 3, boards: [board] }), one('Page 1'))
  })

  it('refuses what isn’t JSON, an object, or has no pages', () => {
    assert.include(why('{nope'), 'isn’t JSON')
    for (const bad of [[], 'text', null, 4]) assert.include(why(JSON.stringify(bad)), 'is an object')
    assert.include(why({}), 'no pages')
    assert.include(why({ pages: [] }), 'no pages')
    assert.include(why({ pages: 'x' }), 'no pages')
  })

  it('refuses too many pages and too many boards', () => {
    const page = (n: number) => ({ name: `p${n}`, boards: [board] })
    assert.include(why({ pages: Array.from({ length: BOARDS_LIMITS.pages + 1 }, (_, n) => page(n)) }), 'at most 40')
    assert.isTrue(read({ pages: Array.from({ length: BOARDS_LIMITS.pages }, (_, n) => page(n)) }).ok)
    const boards = (count: number) =>
      Array.from({ length: count }, (_, n) => ({ name: `b${n}`, file: 'home.html', width: 200, height: 200 }))
    assert.include(
      why({
        pages: [
          { name: 'a', boards: boards(100) },
          { name: 'b', boards: boards(21) },
        ],
      }),
      'more than 120 boards',
    )
    assert.isTrue(
      read({
        pages: [
          { name: 'a', boards: boards(100) },
          { name: 'b', boards: boards(20) },
        ],
      }).ok,
    )
  })

  it('refuses a page that is malformed, unnamed, too long a name, repeated or empty', () => {
    assert.include(why({ pages: ['x'] }), 'Page 1 is an object')
    assert.include(why({ pages: [{ name: 'a' }] }), 'Page 1 is an object')
    assert.include(why({ pages: [{ boards: [board] }] }), 'Page 1 needs a name')
    assert.include(why({ pages: [{ name: ' ', boards: [board] }] }), 'Page 1 needs a name')
    assert.include(why({ pages: [{ name: 'x'.repeat(81), boards: [board] }] }), 'Page 1 needs a name')
    assert.include(
      why({
        pages: [
          { name: 'a', boards: [board] },
          { name: 'a', boards: [board] },
        ],
      }),
      'Two pages are called a',
    )
    assert.include(why({ pages: [{ name: 'a', boards: [] }] }), 'a has no boards')
  })

  it('refuses a board that is malformed, unnamed, repeated, without a drawable or present file', () => {
    assert.include(why(on('x')), 'Board 1 of a is an object')
    assert.include(why(on({ ...board, name: '' })), 'Board 1 of a needs a name')
    assert.include(why(on({ ...board, name: 7 })), 'needs a name')
    assert.include(why(on({ ...board, name: 'x'.repeat(81) })), 'needs a name')
    assert.include(why({ pages: [{ name: 'a', boards: [board, board] }] }), 'Two boards on a are called Home')
    assert.include(why(on({ ...board, file: undefined })), 'needs a file')
    assert.include(why(on({ ...board, file: 'app.js' })), 'needs a file')
    assert.include(why(on({ ...board, file: './' })), 'needs a file')
    assert.include(why(on({ ...board, file: 'missing.html' })), 'which isn’t in the canvas')
    for (const file of ['a.htm', 'a.SVG', 'a.png', 'a.jpeg', 'a.gif', 'a.webp', 'a.avif'])
      assert.isTrue(read(on({ ...board, file })).ok, file)
  })

  it('refuses a size that isn’t whole pixels within bounds, and takes the bounds themselves', () => {
    const sized = (width: unknown, height: unknown) => on({ ...board, width, height })
    for (const [w, h] of [
      [119, 900],
      [1440, 10_001],
      [1440.5, 900],
      ['1440', 900],
      [1440, undefined],
      [1440, null],
    ])
      assert.include(why(sized(w, h)), 'whole pixels', `${w}x${h}`)
    assert.isTrue(read(sized(BOARDS_LIMITS.smallest, BOARDS_LIMITS.largest)).ok)
  })
})

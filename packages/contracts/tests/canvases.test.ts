import { assert, describe, it } from '@effect/vitest'

import {
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
  const files = new Set(['checkout/desktop.html', 'checkout/phone.html', 'logo.svg'])
  const has = (path: string) => files.has(path)
  const board = (over: Record<string, unknown> = {}) => ({
    name: 'Desktop',
    file: 'checkout/desktop.html',
    width: 1440,
    height: 900,
    ...over,
  })
  const read = (said: unknown) => readBoards(typeof said === 'string' ? said : JSON.stringify(said), has)
  const why = (said: unknown) => {
    const read_ = read(said)
    assert.isFalse(read_.ok)
    return read_.ok ? '' : read_.why
  }

  it('is read as its pages, each board’s name trimmed and its file from the canvas’s own folder', () => {
    assert.deepStrictEqual(
      read({
        pages: [
          {
            name: ' Checkout ',
            boards: [board({ name: ' Desktop ' }), board({ name: 'Phone', file: './checkout/phone.html', width: 390, height: 844 })],
          },
          { name: 'Brand', boards: [board({ name: 'Logo', file: 'logo.svg', width: 120, height: 10_000 })] },
        ],
      }),
      {
        ok: true,
        boards: {
          pages: [
            {
              name: 'Checkout',
              boards: [
                { name: 'Desktop', file: 'checkout/desktop.html', width: 1440, height: 900 },
                { name: 'Phone', file: 'checkout/phone.html', width: 390, height: 844 },
              ],
            },
            { name: 'Brand', boards: [{ name: 'Logo', file: 'logo.svg', width: 120, height: 10_000 }] },
          ],
        },
      },
    )
  })

  it('may be one page written as its boards alone, named or called Page 1', () => {
    const one = read({ name: 'Checkout', boards: [board()] })
    assert.isTrue(one.ok && one.boards.pages[0]?.name === 'Checkout')
    for (const name of [undefined, '  ', 3]) {
      const unnamed = read({ name, boards: [board()] })
      assert.isTrue(unnamed.ok && unnamed.boards.pages[0]?.name === 'Page 1', String(name))
    }
  })

  it('says what is wrong with what isn’t a canvas of pages', () => {
    assert.include(why('{not json'), 'isn’t JSON')
    for (const said of [[], null, '"x"', 3]) assert.include(why(said), 'is an object with pages', String(said))
    for (const said of [{}, { pages: [] }, { boards: 'none' }]) assert.include(why(said), 'has no pages')
    assert.include(why({ pages: Array.from({ length: BOARDS_LIMITS.pages + 1 }, () => ({ name: 'P', boards: [board()] })) }), 'at most 40')
  })

  it('says what is wrong with a page', () => {
    assert.include(why({ pages: ['page'] }), 'Page 1 is an object')
    assert.include(why({ pages: [{ name: 'P' }] }), 'Page 1 is an object')
    for (const name of [undefined, ' ', 'x'.repeat(BOARDS_LIMITS.name + 1)])
      assert.include(why({ pages: [{ name, boards: [board()] }] }), 'Page 1 needs a name')
    assert.include(
      why({
        pages: [
          { name: 'P', boards: [board()] },
          { name: ' P', boards: [board()] },
        ],
      }),
      'Two pages are called P',
    )
    assert.include(why({ pages: [{ name: 'P', boards: [] }] }), 'P has no boards')
  })

  it('says what is wrong with a board', () => {
    const on = (b: unknown) => why({ pages: [{ name: 'P', boards: [b] }] })
    assert.include(on('board'), 'Board 1 of P is an object')
    for (const name of [undefined, '', 'x'.repeat(BOARDS_LIMITS.name + 1)]) assert.include(on(board({ name })), 'Board 1 of P needs a name')
    assert.include(why({ pages: [{ name: 'P', boards: [board(), board({ name: 'Desktop ' })] }] }), 'Two boards on P are called Desktop')
    for (const file of [undefined, '', 'app.js']) assert.include(on(board({ file })), 'Desktop on P needs a file')
    assert.include(on(board({ file: 'missing.png' })), 'is drawn from missing.png, which isn’t in the canvas')
    for (const size of [undefined, '900', 1.5, BOARDS_LIMITS.smallest - 1, BOARDS_LIMITS.largest + 1]) {
      assert.include(on(board({ width: size })), 'needs a width and a height', String(size))
      assert.include(on(board({ height: size })), 'needs a width and a height', String(size))
    }
  })

  it('has at most so many boards in all its pages', () => {
    const boards = Array.from({ length: 30 }, (_, at) => board({ name: `B${at}` }))
    const pages = Array.from({ length: 5 }, (_, at) => ({ name: `P${at}`, boards }))
    assert.include(why({ pages }), `more than ${BOARDS_LIMITS.boards} boards`)
    assert.isTrue(read({ pages: pages.slice(0, 4) }).ok)
  })
})

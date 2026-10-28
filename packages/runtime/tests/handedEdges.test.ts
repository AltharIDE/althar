import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { ProjectId } from '@althar/domain'
import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { handedByTool, handedNow, keepPicture, type KeptPicture, PICTURE_KEPT, together } from '../src/handed'
import { runtime, task } from './support'

/*
 * What agents hand back, at the edges handed.test.ts doesn't reach: a
 * picture whose header is cut short, one handed whole under its limit with
 * where it came from, links that name a file differently from where it is,
 * and what a write tool's input says it wrote.
 */

const PNG = Buffer.from(SCREENSHOT_PNG, 'base64')

/** A PNG's signature and nothing after it: a picture by its kind, with no size to read. */
const CUT_SHORT = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const placeIn = (folder?: string) => ({
  projectId: 'prj_0' as ProjectId,
  itemId: 'item_0',
  folders: folder === undefined ? [] : [folder],
})

describe('a picture an agent hands back', () => {
  it.live('is kept without a size where its header is cut short', () =>
    Effect.gen(function* () {
      const { project } = yield* task()
      const kept = yield* keepPicture({ ...placeIn(), projectId: project.projectId as ProjectId }, CUT_SHORT, 'image/png', 'cut.png')
      assert.deepInclude(kept, { mediaType: 'image/png', bytes: 8, width: null, height: null, name: 'cut.png' })
      assert.isNotNull(kept.sha256)
      assert.isUndefined(kept.why)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('says it was not kept, with no size, where there is no store and its header is cut short', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* keepPicture(placeIn(), CUT_SHORT, 'image/png', null), {
        artifactId: null,
        sha256: null,
        mediaType: 'image/png',
        bytes: 8,
        width: null,
        height: null,
        name: null,
        why: 'unkept',
      })
    }).pipe(Effect.provide(runtime(':memory:', {}, { artifactsRoot: null }))),
  )

  it.live('is too large to keep however it came, embedded in a reply too', () =>
    Effect.gen(function* () {
      const huge = Buffer.alloc(PICTURE_KEPT + 1).toString('base64')
      const embedded = yield* handedNow(placeIn(), { _tag: 'Embedded', uri: 'file:///w/shots/huge.png', mimeType: 'image/png', blob: huge })
      assert.deepInclude(embedded.pictures[0], { name: 'huge.png', why: 'too_large', sha256: null })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('handed whole, is named by where it came from; at a data address, by nothing where it has no title', () =>
    Effect.gen(function* () {
      const whole = yield* handedNow(placeIn(), { _tag: 'Image', data: SCREENSHOT_PNG, mimeType: 'image/png', uri: '/w/shots/home.png' })
      assert.deepInclude(whole.pictures[0], { name: 'home.png', width: 480, height: 300 })
      const inline = yield* handedNow(placeIn(), { _tag: 'Link', uri: `data:image/png;base64,${SCREENSHOT_PNG}`, name: 'image' })
      assert.deepInclude(inline.pictures[0], { name: null, width: 480 })
    }).pipe(Effect.provide(runtime())),
  )

  it.live('linked by a name of its own, keeps that name, too large or not; a file linked with no type is noted with none', () =>
    Effect.gen(function* () {
      const folder = mkdtempSync(join(tmpdir(), 'althar-handed-'))
      writeFileSync(join(folder, 'shot.png'), PNG)
      writeFileSync(join(folder, 'big.png'), Buffer.alloc(PICTURE_KEPT + 1))
      writeFileSync(join(folder, 'notes.txt'), 'Notes\n')
      const place = placeIn(folder)
      const shot = yield* handedNow(place, { _tag: 'Link', uri: 'shot.png', name: 'The home screen' })
      assert.deepInclude(shot.pictures[0], { name: 'The home screen', width: 480 })
      const big = yield* handedNow(place, { _tag: 'Link', uri: 'big.png', name: 'Everything', mimeType: 'image/png' })
      assert.deepInclude(big.pictures[0], { name: 'Everything', why: 'too_large', mediaType: 'image/png' })
      const notes = yield* handedNow(place, { _tag: 'Link', uri: 'notes.txt', name: 'notes.txt' })
      assert.deepStrictEqual(notes.files, [{ path: join(folder, 'notes.txt'), how: 'linked', mediaType: null, bytes: null, title: null }])
    }).pipe(Effect.provide(runtime())),
  )
})

describe('what an item had, with what comes after', () => {
  const unkept = (name: string, bytes: number): KeptPicture => ({
    artifactId: null,
    sha256: null,
    mediaType: 'image/png',
    bytes,
    width: null,
    height: null,
    name,
    why: 'too_large',
  })

  it('takes a picture not kept for the same one only by its name and size', () => {
    const had = { pictures: [unkept('a.png', 10)], files: [] }
    assert.deepStrictEqual(together(had, { pictures: [unkept('a.png', 10)], files: [] }).pictures, [unkept('a.png', 10)])
    assert.deepStrictEqual(together(had, { pictures: [unkept('a.png', 11), unkept('b.png', 10)], files: [] }).pictures, [
      unkept('a.png', 10),
      unkept('a.png', 11),
      unkept('b.png', 10),
    ])
  })

  it('takes a file for the same one only by its path and how it came', () => {
    const file = (path: string, how: 'wrote' | 'linked') => ({ path, how, mediaType: null, bytes: null, title: null })
    const had = { pictures: [], files: [file('/w/a.md', 'wrote')] }
    assert.deepStrictEqual(together(had, { pictures: [], files: [file('/w/a.md', 'wrote'), file('/w/a.md', 'linked')] }).files, [
      file('/w/a.md', 'wrote'),
      file('/w/a.md', 'linked'),
    ])
  })
})

describe('a file a tool wrote whole', () => {
  it.live('is read from its path by any of the names agents give it, and not where it names none', () =>
    Effect.gen(function* () {
      const place = placeIn('/w')
      const byPath = yield* handedByTool(place, [], { path: 'docs/a.md', content: '# A\n' }, 'edit')
      assert.deepStrictEqual(
        byPath.files.map((file) => [file.path, file.how]),
        // Resolved in its folder the way this system writes a path: `D:\w\docs\a.md` on Windows.
        [[resolve('/w', 'docs', 'a.md'), 'wrote']],
      )
      assert.deepStrictEqual(yield* handedByTool(place, [], { file_path: '', content: '# A\n' }, 'edit'), { pictures: [], files: [] })
    }).pipe(Effect.provide(runtime())),
  )
})

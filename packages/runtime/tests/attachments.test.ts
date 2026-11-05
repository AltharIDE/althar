import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, ftruncateSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MESSAGE_FILES } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'

import { copyName, copyTo, measure, mediaTypeOf, wordsOf } from '../src/attachments'

/*
 * What a person drops on a message, measured and copied (attachments.ts):
 * a file or a folder within the budget, never a link inside one, nothing
 * left of a copy refused; its name made one a path can hold; and a small
 * text file's words.
 */

const folder = () => mkdtempSync(join(tmpdir(), 'althar-attachments-'))

/** A file as big as asked, holding nothing: the system keeps it sparse. */
const sized = (path: string, bytes: number) => {
  const handle = openSync(path, 'w')
  ftruncateSync(handle, bytes)
  closeSync(handle)
}

/** A link, where the system lets a test make one (Windows may not). */
const linked = (target: string, path: string) => {
  try {
    symlinkSync(target, path)
    return true
  } catch {
    return false
  }
}

describe('measuring what was dropped', () => {
  it('measures a file, or a folder’s files at every depth, and leaves its links out', () => {
    const root = folder()
    writeFileSync(join(root, 'a.txt'), 'abc')
    mkdirSync(join(root, 'deep', 'er'), { recursive: true })
    writeFileSync(join(root, 'deep', 'er', 'b.txt'), 'de')
    const link = linked(join(root, 'a.txt'), join(root, 'link.txt'))
    assert.deepStrictEqual(measure(join(root, 'a.txt')), { ok: true, kind: 'file', bytes: 3, entries: null })
    assert.deepStrictEqual(measure(root), { ok: true, kind: 'folder', bytes: 5, entries: 2 })
    assert.isTrue(link || !existsSync(join(root, 'link.txt')))
    assert.deepStrictEqual(measure(join(root, 'gone')), { ok: false, why: 'unreadable' })
  })

  it('refuses a file or a folder over the budget, by its bytes or its files', () => {
    const big = folder()
    sized(join(big, 'huge.bin'), MESSAGE_FILES.bytes + 1)
    assert.deepStrictEqual(measure(join(big, 'huge.bin')), { ok: false, why: 'too_large' })
    assert.deepStrictEqual(measure(big), { ok: false, why: 'too_large' })
    const many = folder()
    for (let i = 0; i <= MESSAGE_FILES.entries; i++) writeFileSync(join(many, `${i}.txt`), '')
    assert.deepStrictEqual(measure(many), { ok: false, why: 'too_many_files' })
  })
})

describe('a copy’s name', () => {
  it('keeps the file’s own name, but for what a path can’t hold, cut short with its extension', () => {
    assert.strictEqual(copyName('notes.md'), 'notes.md')
    assert.strictEqual(copyName('C:\\Users\\ada\\plan.pdf'), 'plan.pdf')
    assert.strictEqual(copyName('a<b>:c?.txt'), 'a_b__c_.txt')
    assert.strictEqual(copyName('..'), 'file')
    const long = copyName(`${'x'.repeat(300)}.tar.gz`)
    assert.lengthOf(long, 200)
    assert.isTrue(long.endsWith('x.gz'))
  })
})

describe('copying what was dropped', () => {
  it('copies a file or a folder within the budget, its links left out', async () => {
    const from = folder()
    writeFileSync(join(from, 'a.txt'), 'abc')
    mkdirSync(join(from, 'sub'))
    writeFileSync(join(from, 'sub', 'b.txt'), 'de')
    linked(join(from, 'sub'), join(from, 'sublink'))
    const to = folder()
    assert.deepStrictEqual(await copyTo(join(from, 'a.txt'), join(to, 'one', 'a.txt')), { ok: true, kind: 'file', bytes: 3, entries: null })
    assert.deepStrictEqual(await copyTo(from, join(to, 'all')), { ok: true, kind: 'folder', bytes: 5, entries: 2 })
    assert.isTrue(existsSync(join(to, 'all', 'sub', 'b.txt')))
    assert.isFalse(existsSync(join(to, 'all', 'sublink', 'b.txt')))
  })

  it('stops a copy over its budget and leaves nothing of it', async () => {
    const from = folder()
    writeFileSync(join(from, 'a.txt'), 'abc')
    writeFileSync(join(from, 'b.txt'), 'de')
    const to = folder()
    assert.deepStrictEqual(await copyTo(join(from, 'a.txt'), join(to, 'a.txt'), { bytes: 2, entries: 10 }), {
      ok: false,
      why: 'too_large',
    })
    assert.deepStrictEqual(await copyTo(from, join(to, 'bytes'), { bytes: 4, entries: 10 }), { ok: false, why: 'too_large' })
    assert.isFalse(existsSync(join(to, 'bytes')))
    assert.deepStrictEqual(await copyTo(from, join(to, 'files'), { bytes: 100, entries: 1 }), { ok: false, why: 'too_many_files' })
    assert.isFalse(existsSync(join(to, 'files')))
  })
})

describe('a dropped file’s words', () => {
  it('reads a small text file, and nothing of one too big, binary, not UTF-8 or gone', () => {
    const root = folder()
    writeFileSync(join(root, 'a.txt'), 'hello')
    writeFileSync(join(root, 'nul.bin'), Buffer.from([0x61, 0, 0x62]))
    writeFileSync(join(root, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    assert.strictEqual(wordsOf(join(root, 'a.txt'), 5), 'hello')
    assert.isNull(wordsOf(join(root, 'a.txt'), MESSAGE_FILES.embedded + 1))
    assert.isNull(wordsOf(join(root, 'nul.bin'), 3))
    assert.isNull(wordsOf(join(root, 'latin.txt'), 4))
    assert.isNull(wordsOf(join(root, 'gone.txt'), 4))
    sized(join(root, 'grown.txt'), MESSAGE_FILES.embedded + 10)
    assert.isNull(wordsOf(join(root, 'grown.txt'), MESSAGE_FILES.embedded))
    assert.strictEqual(mediaTypeOf('Plan.PDF'), 'application/pdf')
    assert.isNull(mediaTypeOf('notes.xyz'))
  })
})

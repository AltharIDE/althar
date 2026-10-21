import type { Evidence } from '@althar/contracts'
import { EvidenceKind } from '@althar/ui'
import { describe, expect, it } from 'vitest'

import { pieceOf } from '../src/renderer/shared/evidence'
import { splitStory } from '../src/renderer/shared/outcome'

/*
 * What a task came to, as its Outputs page tells it: the part of its story
 * that says what it is apart from the rest, and each piece of what its lead
 * showed, as the kit draws it, where the lead left something unsaid.
 */

const DIGEST = 'b'.repeat(64)
const piece = (over: Partial<Evidence>): Evidence => ({
  kind: 'note',
  caption: 'A note',
  picture: null,
  command: null,
  exit: null,
  text: null,
  dropped: 0,
  ...over,
})
const PICTURE = { digest: DIGEST, mediaType: 'image/png', bytes: 2048, width: 1440, height: 900, name: 'evidence.png', unkept: null }

describe('a task’s story', () => {
  it('takes a list’s first item as what it is, and keeps the rest of the list with what follows', () => {
    expect(splitStory('- Checkout retries once\n- The limit is 3\n\nTested by hand.')).toEqual({
      lede: 'Checkout retries once',
      rest: '- The limit is 3\n\nTested by hand.',
    })
    expect(splitStory('* One thing')).toEqual({ lede: 'One thing', rest: '' })
  })

  it('says nothing of what it is where its story is all headings', () => {
    expect(splitStory('## Why\n\n### How')).toEqual({ lede: '', rest: '## Why\n\n### How' })
  })
})

describe('a piece of evidence', () => {
  it('draws a picture without its size where its size isn’t known, called by its caption where it has no name', () => {
    const shot = pieceOf(
      piece({ kind: 'screenshot', caption: 'The board', picture: { ...PICTURE, name: null, width: null, height: null } }),
      's',
    )
    expect(shot).toEqual({
      id: 's',
      kind: EvidenceKind.Screenshot,
      caption: 'The board',
      form: 'picture',
      shot: {
        name: 'The board',
        alt: 'The board',
        src: `althar-picture://shot/${DIGEST}`,
        thumb: `althar-picture://shot/${DIGEST}?w=1120`,
        meta: '2 KB',
      },
    })
    // Its width alone isn't a size either.
    expect(pieceOf(piece({ kind: 'screenshot', picture: { ...PICTURE, height: null } }), 'w')).toMatchObject({
      shot: { meta: '2 KB', width: 1440 },
    })
  })

  it('says a picture wasn’t kept, where Althar doesn’t say why', () => {
    expect(pieceOf(piece({ kind: 'recording', caption: 'The flow', picture: { ...PICTURE, digest: null } }), 'r')).toMatchObject({
      kind: EvidenceKind.Recording,
      form: 'picture',
      shot: { status: 'failed', meta: 'Not kept', width: 1440, height: 900 },
    })
  })

  it('opens a command that printed nothing to its command alone', () => {
    expect(pieceOf(piece({ kind: 'command', caption: 'Lint', command: 'bun run lint', exit: 0 }), 'c')).toEqual({
      id: 'c',
      kind: EvidenceKind.Command,
      caption: 'Lint',
      form: 'output',
      lines: [],
      command: 'bun run lint',
      exit: 0,
    })
  })

  it('shows a long log’s last lines, those before them a click away', () => {
    const printed = Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join('\n')
    const log = pieceOf(piece({ kind: 'log', caption: 'The server', text: `${printed}\n` }), 'l')
    expect(log).toMatchObject({ form: 'output', earlier: ['line 1', 'line 2', 'line 3'] })
    expect(log.form === 'output' && [log.lines[0], log.lines.at(-1), log.lines.length]).toEqual(['line 4', 'line 15', 12])
  })

  it('says a note with nothing in it by its caption alone', () => {
    expect(pieceOf(piece({ caption: 'Looked in Safari' }), 'n')).toEqual({
      id: 'n',
      kind: EvidenceKind.Note,
      caption: 'Looked in Safari',
      form: 'note',
    })
  })
})

import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { OPUS } from '../src/fixtures/models'
import { SHOT_AFTER, SHOT_BEFORE, SHOT_NOT_KEPT } from '../src/fixtures/shots'
import { EvidenceKind, ToolKind, ToolState, Verdict } from '../src/foundations/vocabulary'
import { AltharLine } from '../src/thread/AltharLine/AltharLine'
import { Checked } from '../src/thread/Checked/Checked'
import type { EvidencePiece } from '../src/thread/Evidence/Evidence'
import { Gallery, type GalleryShot, shotName } from '../src/thread/Gallery/Gallery'
import { Lightbox } from '../src/thread/Lightbox/Lightbox'
import { Markdown } from '../src/thread/Markdown/Markdown'
import { Relayed } from '../src/thread/Relayed/Relayed'
import { Reviewer } from '../src/thread/Reviewer/Reviewer'
import { Round } from '../src/thread/Round/Round'
import { ThreadShellProvider, type ImageRef } from '../src/thread/Shell/Shell'
import { Tool } from '../src/thread/Tool/Tool'
import { WorkLine, WorkNote, WorkSaid, WorkShots } from '../src/thread/WorkLine/WorkLine'

/* A thread's host with a lightbox, as the app has one. */
function Host({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<{ set: readonly ImageRef[]; at: number } | null>(null)
  return (
    <ThreadShellProvider value={{ openImage: (image, set = [image]) => setOpen({ set, at: set.indexOf(image) }) }}>
      {children}
      {open && <Lightbox images={open.set} defaultIndex={open.at} onClose={() => setOpen(null)} />}
    </ThreadShellProvider>
  )
}

const shot = (id: string, caption: string, from: ImageRef = SHOT_AFTER, size?: { width: number; height: number }): GalleryShot => ({
  ...from,
  id,
  caption,
  name: `${id}.png`,
  ...size,
})

describe('Round', () => {
  it('names who answers once, with what it is there as and when', () => {
    render(
      <Round model={OPUS} part="Review" at="3m ago">
        <p>Looks good to me.</p>
      </Round>,
    )
    const round = screen.getByRole('article', { name: OPUS.name })
    expect(within(round).getByText('Review')).toBeInTheDocument()
    expect(within(round).getByText('3m ago')).toBeInTheDocument()
  })

  it('copies what it said, where it is given something to copy', () => {
    const { rerender } = render(
      <Round model={OPUS} copy="Done: it retries once.">
        <p>Done: it retries once.</p>
      </Round>,
    )
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    rerender(
      <Round model={OPUS} copy="Done." text={{ copy: { copy: 'Copy the answer' } }}>
        <p>Done.</p>
      </Round>,
    )
    expect(screen.getByRole('button', { name: 'Copy the answer' })).toBeInTheDocument()
    rerender(
      <Round model={OPUS} copy="">
        <p>Nothing.</p>
      </Round>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('leaves out what it isn’t told', () => {
    render(
      <Round model={OPUS} at="">
        <p>Said.</p>
      </Round>,
    )
    expect(screen.queryByText('Review')).not.toBeInTheDocument()
  })
})

describe('WorkLine', () => {
  it('is one line that opens to every step, what it said on the way among them', async () => {
    const user = userEvent.setup()
    render(
      <WorkLine took="4m" summary="edited 1 file">
        <Tool kind={ToolKind.Edit} verb="Edited" target="src/a.ts" state={ToolState.Done} />
        <WorkSaid source="On the way: **this**." />
        <WorkNote>A branch of its own now.</WorkNote>
      </WorkLine>,
    )
    const row = screen.getByRole('button', { name: /Worked 4m · ?edited 1 file|Worked 4medited 1 file/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(screen.getByText('this')).toBeInTheDocument())
    expect(screen.getByText('A branch of its own now.')).toBeInTheDocument()
  })

  it('says it is at work, and what on, while the lead works', () => {
    render(
      <WorkLine took="12s" live summary="Reading the tests">
        <WorkNote>x</WorkNote>
      </WorkLine>,
    )
    expect(screen.getByRole('button', { name: /Working · 12s/ })).toHaveAttribute('aria-busy', 'true')
  })

  it('doesn’t open with nothing in it', () => {
    render(<WorkLine took="2s" live />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Working · 2s')).toBeInTheDocument()
  })

  it('names who worked for a round that said nothing', () => {
    const { rerender } = render(
      <WorkLine took="43s" who={OPUS} summary="">
        <WorkNote>x</WorkNote>
      </WorkLine>,
    )
    expect(screen.getByRole('button', { name: new RegExp(`${OPUS.name}.*worked 43s`) })).toBeInTheDocument()
    rerender(
      <WorkLine took="43s" who={OPUS} live>
        <WorkNote>x</WorkNote>
      </WorkLine>,
    )
    expect(screen.getByText('working · 43s')).toBeInTheDocument()
  })
})

describe('WorkShots', () => {
  it('shows what the lead looked at small, each opening full size with the others', async () => {
    const user = userEvent.setup()
    render(
      <Host>
        <WorkShots
          shots={[
            { ...SHOT_BEFORE, id: 'b', name: 'before.png' },
            { ...SHOT_AFTER, id: 'a', name: 'after.png' },
          ]}
        />
      </Host>,
    )
    await user.click(screen.getByRole('button', { name: 'View after.png full size' }))
    expect(within(await screen.findByRole('dialog')).getByText('2 of 2')).toBeInTheDocument()
  })

  it('doesn’t open them without a lightbox, or one not kept, and draws nothing with none', () => {
    const { container, rerender } = render(<WorkShots shots={[{ ...SHOT_AFTER, id: 'a', name: 'after.png' }]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(
      <Host>
        <WorkShots shots={[{ ...SHOT_NOT_KEPT, id: 'g', name: 'gone.png' }]} text={{ view: (name) => `Open ${name}` }} />
      </Host>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<WorkShots shots={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Gallery', () => {
  const NAMED = [
    shot('a1', 'A1 · One quiet line: the reason lands under the refusal'),
    shot('a2', 'A2 · Two refused, each with its reason', SHOT_BEFORE),
    shot('b1', 'B1 · Inline, in the row'),
    shot('z', 'Z · The comparison page (full page)', SHOT_BEFORE, { width: 1440, height: 4200 }),
  ]

  it('names a picture from its caption, where it starts with a name', () => {
    expect(shotName('A1 · One quiet line: …')).toBe('A1')
    expect(shotName('T1 Today: the panel')).toBe('T1')
    expect(shotName('Z · The comparison page')).toBe('Z')
    expect(shotName('Before: the button')).toBeNull()
    expect(shotName('A merged task back at work')).toBeNull()
  })

  it('groups pictures by their names, under what the first of a group says it is', async () => {
    const user = userEvent.setup()
    render(
      <Host>
        <Gallery shots={NAMED} />
      </Host>,
    )
    expect(screen.getByRole('heading', { name: 'A · One quiet line' })).toBeInTheDocument()
    expect(screen.getByText('A1 · the reason lands under the refusal')).toBeInTheDocument()
    // B1 doesn't say what B is before a colon: no heading, its whole caption.
    expect(screen.getByText('B1 · Inline, in the row')).toBeInTheDocument()
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'View B1 · Inline, in the row full size' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('3 of 4')).toBeInTheDocument()
  })

  it('keeps pictures with no names together, two across', () => {
    const { container } = render(
      <Gallery shots={[shot('one', 'Before'), shot('two', 'After'), shot('a1', 'A1 · Named: it'), shot('three', 'Later')]} />,
    )
    expect(container.querySelectorAll('section')).toHaveLength(3)
    expect(container.querySelector('section')?.querySelectorAll('figure')).toHaveLength(2)
  })

  it('shows a whole page’s top, and one picture wider still', () => {
    const { container, rerender } = render(<Gallery shots={NAMED} />)
    expect(container.querySelectorAll('[class*="tall"]')).toHaveLength(1)
    rerender(<Gallery shots={[shot('one', 'After')]} />)
    expect(container.querySelector('[class*="wideOne"]')).not.toBeNull()
  })

  it('doesn’t open pictures without a lightbox, or one Althar couldn’t keep', () => {
    const { rerender } = render(<Gallery shots={[shot('a', 'After')]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(
      <Host>
        <Gallery shots={[shot('gone', 'The whole page', SHOT_NOT_KEPT)]} />
      </Host>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('counts the views it took again in a line, which opens them on a click', async () => {
    const user = userEvent.setup()
    const again = [shot('a2b', 'A2 · Again'), shot('b1b', 'B1 · Again'), shot('cb', 'Again, unnamed')]
    const { rerender } = render(
      <Host>
        <Gallery shots={[shot('s1', 'S1 · The switcher')]} retaken={again} />
      </Host>,
    )
    await user.click(screen.getByRole('button', { name: 'Also retook 3 shown earlier' }))
    expect(within(await screen.findByRole('dialog')).getByText('1 of 3')).toBeInTheDocument()
    rerender(
      <Host>
        <Gallery shots={[]} retaken={again.slice(0, 1)} />
      </Host>,
    )
    expect(screen.getByText(/^Retook/)).toBeInTheDocument()
  })

  it('draws nothing with nothing to show', () => {
    const { container } = render(<Gallery shots={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Relayed', () => {
  it('says what was passed on in a line and three more, and all of it on a click', async () => {
    const user = userEvent.setup()
    render(<Relayed title="one more round" body="they want it live" />)
    expect(screen.getByText('From the coordinator')).toBeInTheDocument()
    expect(screen.getByText('one more round')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all' }))
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('stands without a title', () => {
    render(<Relayed title={null} body="Only the words." />)
    expect(screen.getByText('Only the words.')).toBeInTheDocument()
  })
})

describe('AltharLine', () => {
  it('says it by name, warm where it is now the person’s', () => {
    const { container, rerender } = render(<AltharLine>A conflict.</AltharLine>)
    expect(screen.getByText('Althar')).toBeInTheDocument()
    expect(container.querySelector('[class*="warning"]')).toBeNull()
    rerender(<AltharLine tone="warning">It couldn’t.</AltharLine>)
    expect(container.querySelector('[class*="warning"]')).not.toBeNull()
  })
})

describe('Reviewer', () => {
  it('says its verdict in a sentence, then each finding', () => {
    const { rerender } = render(
      <Reviewer
        verdict={Verdict.Changes}
        findings={[
          { id: '1', weight: 'major', at: 'a.ts:3', claim: 'Wrong `x`.' },
          { id: '2', weight: 'nit', claim: 'A name.' },
        ]}
      />,
    )
    expect(screen.getByText('Needs changes: 2 findings.')).toBeInTheDocument()
    expect(screen.getByText('Major')).toBeInTheDocument()
    expect(screen.getByText('a.ts:3')).toBeInTheDocument()
    rerender(<Reviewer verdict={Verdict.Changes} findings={[{ id: '1', weight: 'blocking', claim: 'Breaks.' }]} />)
    expect(screen.getByText('Needs changes: one finding.')).toBeInTheDocument()
    rerender(<Reviewer verdict={Verdict.Changes} findings={[]} />)
    expect(screen.getByText('Needs changes.')).toBeInTheDocument()
    rerender(<Reviewer verdict={Verdict.Pass} findings={[]} />)
    expect(screen.getByText('Looks good to me.')).toBeInTheDocument()
    rerender(<Reviewer verdict={Verdict.Pass} findings={[{ id: '1', weight: 'minor', claim: 'Fine.' }]} />)
    expect(screen.getByText('Looks good, with one note:')).toBeInTheDocument()
    rerender(
      <Reviewer
        verdict={Verdict.Pass}
        findings={[
          { id: '1', weight: 'minor', claim: 'a' },
          { id: '2', weight: 'minor', claim: 'b' },
        ]}
      />,
    )
    expect(screen.getByText('Looks good, with 2 notes:')).toBeInTheDocument()
  })
})

describe('Checked', () => {
  const RUN: EvidencePiece = {
    id: 'run',
    kind: EvidenceKind.TestRun,
    caption: 'The tests',
    form: 'output',
    command: 'bun run test',
    exit: 1,
    lines: ['1 failed'],
  }
  const NOTE: EvidencePiece = { id: 'note', kind: EvidenceKind.Note, caption: 'Compared both', form: 'note', text: 'At two widths.' }
  const BARE: EvidencePiece = { id: 'bare', kind: EvidenceKind.Note, caption: 'Nothing to show', form: 'note' }
  const PICTURE: EvidencePiece = { id: 'pic', kind: EvidenceKind.Screenshot, caption: 'A picture', form: 'picture', shot: SHOT_AFTER }

  it('lists what it checked, a line each opening to what it printed, and what it couldn’t', async () => {
    const user = userEvent.setup()
    render(<Checked pieces={[RUN, NOTE, BARE, PICTURE]} unverified={['Not seen in Safari']} />)
    expect(screen.getByText('What it checked')).toBeInTheDocument()
    expect(screen.queryByText('A picture')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'What it printed: The tests' }))
    await waitFor(() => expect(screen.getByText(/\$ bun run test/)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'What it printed: Compared both' }))
    await waitFor(() => expect(screen.getByText('At two widths.')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Nothing to show/ })).not.toBeInTheDocument()
    expect(screen.getByText('Not seen in Safari')).toBeInTheDocument()
  })

  it('says only what it couldn’t check, and nothing with nothing to say', () => {
    const { container, rerender } = render(<Checked pieces={[]} unverified={['Not tried live']} />)
    expect(screen.queryByText('What it checked')).not.toBeInTheDocument()
    expect(screen.getByText('Not checked')).toBeInTheDocument()
    rerender(<Checked pieces={[PICTURE]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens a run with no command to what it printed alone', async () => {
    const user = userEvent.setup()
    render(<Checked pieces={[{ id: 'log', kind: EvidenceKind.Log, caption: 'The log', form: 'output', lines: ['ok'] }]} />)
    await user.click(screen.getByRole('button', { name: 'What it printed: The log' }))
    await waitFor(() => expect(screen.getByText('ok')).toBeInTheDocument())
  })
})

describe('Markdown', () => {
  it('sets a single line of code with its copy beside it, and a longer block with its copy over it', () => {
    const { container } = render(<Markdown source={'```\ncd apps/site && bunx vp dev\n```\n\n```\na\nb\n```'} />)
    const blocks = container.querySelectorAll('pre')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.parentElement?.className).toMatch(/oneLine/)
    expect(blocks[1]?.parentElement?.className).not.toMatch(/oneLine/)
  })

  it('draws a table as rows of words that wrap', () => {
    const { container } = render(<Markdown source={'| Setting | Where |\n|---|---|\n| Keep awake | Work on this Mac |'} />)
    expect(container.querySelector('[role="region"]')?.className).toMatch(/flat/)
  })
})

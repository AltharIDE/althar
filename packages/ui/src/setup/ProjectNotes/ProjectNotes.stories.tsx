import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Button } from '../../primitives/Button/Button'
import { ControlCenter, ControlDetail, ControlGrid, ControlModule, ControlSheet, ControlWords } from '../ControlCenter/ControlCenter'
import { type KeptNote, ProjectNotes, type ProjectNotesProps } from './ProjectNotes'

/* What a coordinator has kept for a project, oldest first. */
const NOTES: ReadonlyArray<KeptNote> = [
  { id: 'note_1', body: 'Issue drafts need an approval card, on every tracker.' },
  { id: 'note_2', body: 'Dependency setup runs outside the sandbox; don’t widen the lead’s sandbox.' },
  { id: 'note_3', body: 'Refunds share the partner budget: never give them a rate limit of their own.' },
]

/* As a consumer keeps them: one taken out goes at once. */
function Kept(args: ProjectNotesProps) {
  const [notes, setNotes] = useState(args.notes)
  return (
    <ProjectNotes
      {...args}
      notes={notes}
      onRemove={(id) => {
        setNotes((was) => was.filter((note) => note.id !== id))
        args.onRemove(id)
      }}
    />
  )
}

/* On the panel's lighter sheet, at the panel's width, as it sits in the project's settings. */
function Sheet({ children }: { children: ReactNode }) {
  return <div style={{ width: 416, padding: '14px 16px', borderRadius: 15, background: 'var(--frost-raised)' }}>{children}</div>
}

const meta = {
  title: 'Setup/ProjectNotes',
  component: ProjectNotes,
  args: { notes: NOTES, onRemove: fn() },
  render: (args) => (
    <Sheet>
      <Kept {...args} />
    </Sheet>
  ),
} satisfies Meta<typeof ProjectNotes>
export default meta
type Story = StoryObj<typeof meta>

/** What the coordinator kept, oldest first, each a sentence with its ×. */
export const AsItIs: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByRole('listitem')).toHaveLength(3)
    await expect(c.getByRole('button', { name: 'Remove “Issue drafts need an approval card, on every tracker.”' })).toBeInTheDocument()
  },
}

/** Taken out from the keyboard: focus goes to the next one's ×, then the last, then to the words above once none is left. */
export const Removing: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /^Remove “Issue drafts/ }))
    await expect(args.onRemove).toHaveBeenCalledWith('note_1')
    await expect(c.getByRole('button', { name: /^Remove “Dependency setup/ })).toHaveFocus()
    await userEvent.click(c.getByRole('button', { name: /^Remove “Refunds/ }))
    await expect(c.getByRole('button', { name: /^Remove “Dependency setup/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(c.queryByRole('list')).toBeNull()
    await expect(c.getByText(/^None yet\./)).toHaveFocus()
  },
}

/** One that couldn't be taken out says why. */
export const Failed: Story = { args: { error: 'That project isn’t there any more.' } }

/** With none kept, it says what will be here. */
export const None: Story = { args: { notes: [] } }

/** A long note wraps, its × at the top of its line. */
export const LongNote: Story = {
  args: {
    notes: [
      {
        id: 'note_long',
        body: 'Every task that touches the checkout flow is reviewed by a model from another maker, and its pull request stays a draft until the person has tried it on the staging environment with a real card.',
      },
    ],
  },
}

/* In the project's settings: a module that says how many, which opens out to them. */
function Settings(args: ProjectNotesProps) {
  const [open, setOpen] = useState<'all' | 'notes'>('all')
  const [notes, setNotes] = useState(args.notes)
  return (
    <ControlCenter
      defaultOpen
      trigger={
        <Button size="small" variant="quiet" icon="gear">
          Settings
        </Button>
      }
      text={{ label: 'Meridian’s settings' }}
    >
      {open === 'all' ? (
        <ControlGrid>
          <ControlModule title="Notes" aside={String(notes.length)} onClick={() => setOpen('notes')}>
            <ControlWords title={notes.at(-1)?.body ?? 'None yet'} />
          </ControlModule>
        </ControlGrid>
      ) : (
        <ControlDetail title="Notes" onBack={() => setOpen('all')}>
          <ControlSheet>
            <ProjectNotes notes={notes} onRemove={(id) => setNotes((was) => was.filter((note) => note.id !== id))} />
          </ControlSheet>
        </ControlDetail>
      )}
    </ControlCenter>
  )
}

/** In the project's settings, under its button: the module opens out to the notes. */
export const InSettings: Story = {
  render: (args) => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', minHeight: 420, padding: 16 }}>
      <Settings {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const panel = within(await page.findByRole('dialog', { name: 'Meridian’s settings' }))
    await userEvent.click(panel.getByRole('button', { name: /^Notes/ }))
    await expect(panel.getByRole('heading', { name: 'Notes', level: 2 })).toHaveFocus()
    await expect(panel.getAllByRole('listitem')).toHaveLength(3)
  },
}

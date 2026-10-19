import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { type KeptNote, ProjectNotes, type ProjectNotesProps } from './ProjectNotes'

/* What a coordinator has kept for a project, newest first, as the project's settings show them. */
const NOTES: ReadonlyArray<KeptNote> = [
  {
    id: 'note_3',
    body: 'Refunds share the partner budget: never give them a rate limit of their own.',
    kept: 'Kept by the coordinator · 14 Oct',
  },
  {
    id: 'note_2',
    body: 'Dependency setup runs outside the sandbox; don’t widen the lead’s sandbox.',
    kept: 'Kept by you · 9 Oct',
  },
  { id: 'note_1', body: 'Issue drafts need an approval card, on every tracker.', kept: 'Kept by the coordinator · 2 Oct' },
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

/* On a section's sheet, at a page's width, as it sits in the project's settings. */
function Sheet({ children }: { children: ReactNode }) {
  return <div style={{ width: 760, padding: '18px 22px', borderRadius: 12, background: 'var(--n-1)' }}>{children}</div>
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

/** What the coordinator kept, a card each: the decision to read, who kept it and when under it, and its ×. */
export const AsItIs: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByRole('listitem')).toHaveLength(3)
    await expect(c.getByText('Kept by you · 9 Oct')).toBeVisible()
    await expect(c.getByRole('button', { name: 'Remove “Issue drafts need an approval card, on every tracker.”' })).toBeInTheDocument()
  },
}

/** Taken out from the keyboard: focus goes to the next one's ×, then the last, then to the words above once none is left. */
export const Removing: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: /^Remove “Refunds/ }))
    await expect(args.onRemove).toHaveBeenCalledWith('note_3')
    await expect(c.getByRole('button', { name: /^Remove “Dependency setup/ })).toHaveFocus()
    await userEvent.click(c.getByRole('button', { name: /^Remove “Issue drafts/ }))
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

/** A long note wraps on its card, its × in the corner; a narrow sheet has one card across. */
export const LongNote: Story = {
  args: {
    notes: [
      {
        id: 'note_long',
        body: 'Every task that touches the checkout flow is reviewed by a model from another maker, and its pull request stays a draft until the person has tried it on the staging environment with a real card.',
        kept: 'Kept by the coordinator · 11 Oct',
      },
      { id: 'note_short', body: 'Ship on Thursdays.' },
    ],
  },
  render: (args) => (
    <div style={{ width: 360 }}>
      <Kept {...args} />
    </div>
  ),
}

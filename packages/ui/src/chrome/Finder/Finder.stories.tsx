import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ACROSS, LONG, RECENT, RETRY } from '../../fixtures/finder'
import { Button } from '../../primitives/Button/Button'
import { Finder, type FoundRow } from './Finder'

/* Meridian's tasks as a consumer would search them: by the words in their titles and in what matched. */
const ALL: FoundRow[] = [...RETRY, ...RECENT.filter((row) => !RETRY.some((one) => one.id === row.id))]
const search = (query: string) => {
  const words = query.trim().toLowerCase().split(/\s+/)
  if (query.trim() === '') return RECENT
  return ALL.filter((row) => {
    const said = `${row.title} ${row.matched?.map((part) => part.text).join('') ?? ''} ${row.pullRequest ?? ''}`.toLowerCase()
    return words.every((word) => said.includes(word))
  })
}

const opened = fn()

/** The finder behind the button that opens it, searching as you type. */
function Example({ startOpen = true }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const [query, setQuery] = useState('')
  return (
    <>
      <Button onClick={() => setOpen(true)}>Find a task</Button>
      {open && (
        <Finder
          results={search(query)}
          query={query}
          onQueryChange={setQuery}
          onOpen={(id) => {
            opened(id)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
          text={{ search: 'Find a task in meridian' }}
        />
      )}
    </>
  )
}

const meta = {
  title: 'Chrome/Finder',
  component: Finder,
  parameters: { layout: 'fullscreen' },
  args: { results: RECENT, onOpen: fn(), onClose: fn(), text: { search: 'Find a task in meridian' } },
  decorators: [(Story) => <div style={{ minHeight: 640 }}>{Story()}</div>],
} satisfies Meta<typeof Finder>
export default meta
type Story = StoryObj<typeof meta>

/** Opened, with nothing typed: the tasks changed last. */
export const Recent: Story = {}

/** Opened in a project with no tasks yet, or before the first answer: the field alone. */
export const NothingYet: Story = { args: { results: null } }

/** Found in a project: a title, then what was asked, what a lead built, a file; the matched words darker. */
export const Found: Story = { args: { defaultQuery: 'retr', results: RETRY } }

/** On the home: every project, each task with its project's mark. */
export const AcrossProjects: Story = {
  args: { defaultQuery: '1206', results: ACROSS, text: { search: 'Find a task in any project' } },
}

/** Searching for newer words: what the last answer found stays, so nothing flickers. */
export const Searching: Story = {
  args: { defaultQuery: 'retry webh', results: RETRY, searching: true },
  play: async () => {
    const page = within(document.body)
    await expect(page.getAllByRole('option')).toHaveLength(RETRY.length)
    await expect(page.queryByText(/No tasks match/)).toBeNull()
  },
}

/** Nothing found. */
export const NoMatch: Story = {
  args: { defaultQuery: 'pelican', results: [] },
  play: async () => {
    await expect(within(document.body).getByText('No tasks match “pelican”', { selector: 'p' })).toBeVisible()
  },
}

/** Nothing found yet, and an answer on its way: no "nothing found" before it comes. */
export const NoMatchYet: Story = {
  args: { defaultQuery: 'pelican', results: [], searching: true },
  play: async () => {
    await expect(within(document.body).queryByText(/No tasks match/)).toBeNull()
  },
}

/** A long title and a long match: each keeps to its line. */
export const LongContent: Story = { args: { defaultQuery: 'rotation', results: LONG } }

/** You arrive typing; the arrows move along what it found, and Enter opens the one you are on. */
export const Keyboard: Story = {
  render: () => <Example />,
  play: async () => {
    opened.mockClear()
    const page = within(document.body)
    const field = page.getByRole('combobox', { name: 'Find a task in meridian' })
    await expect(field).toHaveFocus()
    await userEvent.type(field, 'retr')
    const options = page.getAllByRole('option')
    await expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await expect(field).toHaveAttribute('aria-activedescendant', options[2]?.id)
    await userEvent.keyboard('{ArrowUp}')
    await expect(options[1]).toHaveAttribute('aria-selected', 'true')
    await expect(field).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(opened).toHaveBeenCalledWith('t414')
  },
}

/** A press opens a task; Escape closes and gives focus back to what opened it. */
export const PressAndEscape: Story = {
  render: () => <Example startOpen={false} />,
  play: async () => {
    opened.mockClear()
    const page = within(document.body)
    const opener = page.getByRole('button', { name: 'Find a task' })
    await userEvent.click(opener)
    await userEvent.click(await page.findByRole('option', { name: /Fix the flaky refund settlement test/ }))
    await expect(opened).toHaveBeenCalledWith('t414')
    await userEvent.click(opener)
    await expect(await page.findByRole('combobox')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
    await expect(opener).toHaveFocus()
  },
}

/*
 * A modal shows one at a time, so its states share one screen: the task the
 * arrows are on (as the pointer puts them too), one pressed, a match in a
 * title, in what was asked, in what a lead built and in a file, and each
 * state's word.
 */
export const AllStates: Story = {
  args: { defaultQuery: 'retr', results: ALL },
  parameters: { pseudo: { active: ['[role="dialog"] [role="option"]:nth-child(4)'] } },
}

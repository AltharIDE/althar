import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../../primitives/Button/Button'
import { type BranchChoice, choiceKey, RunBranch } from './RunBranch'

/* What a Flutter app's remote has to run: two open pull requests, one from a fork, then its branches, the default first. */
const CHOICES: BranchChoice[] = [
  {
    kind: 'pull',
    number: 41,
    name: 'PR #41',
    title: 'Add a services directory',
    branch: 'feature/find-a-pro',
    author: 'mira',
  },
  {
    kind: 'pull',
    number: 38,
    name: 'PR #38',
    title: 'Dark mode for the booking sheet',
    branch: 'dark-booking',
    author: 'oskar',
    draft: true,
    fork: true,
  },
  { kind: 'branch', branch: 'main' },
  { kind: 'branch', branch: 'feature/find-a-pro' },
  { kind: 'branch', branch: 'fix/calendar-timezones' },
  { kind: 'branch', branch: 'release/2.4' },
]

const ran = fn()

/** The picker behind the Run menu's item that opens it: a press fetches, and once it runs, it closes. */
function Example({ startOpen = true, refuse }: { startOpen?: boolean; refuse?: string }) {
  const [open, setOpen] = useState(startOpen)
  const [starting, setStarting] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  return (
    <>
      <Button onClick={() => setOpen(true)}>Run a branch</Button>
      {open && (
        <RunBranch
          choices={CHOICES}
          starting={starting}
          {...(error === undefined ? {} : { error })}
          onRun={(choice) => {
            ran(choice)
            setError(undefined)
            setStarting(choiceKey(choice))
            setTimeout(() => {
              setStarting(null)
              if (refuse !== undefined) setError(refuse)
              else setOpen(false)
            }, 300)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

const meta = {
  title: 'Chrome/RunBranch',
  component: RunBranch,
  parameters: { layout: 'fullscreen' },
  args: { choices: CHOICES, onRun: fn(), onClose: fn() },
  decorators: [(Story) => <div style={{ minHeight: 560 }}>{Story()}</div>],
} satisfies Meta<typeof RunBranch>
export default meta
type Story = StoryObj<typeof meta>

/** Opened: the open pull requests first, each by its title and number, then the branches. */
export const Opened: Story = {
  play: async () => {
    const page = within(document.body)
    await expect(page.getByRole('combobox', { name: 'Run a branch or pull request' })).toHaveFocus()
    const options = page.getAllByRole('option')
    await expect(options).toHaveLength(CHOICES.length)
    await expect(options[0]).toHaveTextContent('Add a services directoryPR #41')
    await expect(within(page.getByRole('group', { name: 'Branches' })).getAllByRole('option')[0]).toHaveTextContent('main')
  },
}

/** While Althar asks the remote: the field, and that it is asking. */
export const Asking: Story = {
  args: { choices: null },
  play: async () => {
    await expect(within(document.body).getByText('Asking the remote…')).toBeVisible()
  },
}

/** Words find a pull request by its branch, and the branch itself: both are ways to run it. */
export const Searched: Story = {
  args: { defaultQuery: 'find-a' },
  play: async () => {
    const options = within(document.body).getAllByRole('option')
    await expect(options).toHaveLength(2)
    await expect(options[0]).toHaveTextContent('Add a services directory')
    await expect(options[1]).toHaveTextContent('feature/find-a-pro')
  },
}

/** A number the list doesn't have, such as a closed pull request's: it runs still. */
export const TypedNumber: Story = {
  args: { defaultQuery: '#57' },
  play: async ({ args }) => {
    const page = within(document.body)
    await expect(page.getAllByRole('option')[0]).toHaveTextContent('Pull request #57')
    await userEvent.keyboard('{Enter}')
    await expect(args.onRun).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pull', number: 57 }))
  },
}

/** Nothing on the remote matches. */
export const NoMatch: Story = {
  args: { defaultQuery: 'pelican' },
  play: async () => {
    await expect(within(document.body).getByText('Nothing on the remote matches “pelican”', { selector: 'p' })).toBeVisible()
  },
}

/** No connection to the code host: its branches still, and why there are no pull requests. */
export const NoPullRequests: Story = {
  args: {
    choices: CHOICES.filter((choice) => choice.kind === 'branch'),
    note: 'Connect GitHub in Settings to see its pull requests here.',
  },
}

/** The one picked, fetching: its row says so, and the others wait. */
export const Fetching: Story = {
  args: { starting: choiceKey(CHOICES[0] as BranchChoice) },
  play: async () => {
    const page = within(document.body)
    await expect(page.getByText('Fetching…')).toBeVisible()
    await expect(page.getAllByRole('option')[1]).toHaveAttribute('aria-disabled', 'true')
  },
}

/** You arrive typing; the arrows move, Enter fetches and runs the one you are on, and the picker closes once it runs. */
export const Keyboard: Story = {
  render: () => <Example />,
  play: async () => {
    ran.mockClear()
    const page = within(document.body)
    const field = page.getByRole('combobox', { name: 'Run a branch or pull request' })
    await userEvent.type(field, 'cal')
    await expect(page.getAllByRole('option')).toHaveLength(1)
    await userEvent.clear(field)
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    await expect(page.getAllByRole('option')[3]).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Enter}')
    await expect(ran).toHaveBeenCalledWith({ kind: 'branch', branch: 'feature/find-a-pro' })
    await expect(page.getByText('Fetching…')).toBeVisible()
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
  },
}

/** What Althar couldn't do stays in the picker, to pick another. */
export const Refused: Story = {
  render: () => <Example refuse="origin has no branch feature/find-a-pr. Like it: feature/find-a-pro." />,
  play: async () => {
    const page = within(document.body)
    await userEvent.click(page.getAllByRole('option')[0] as HTMLElement)
    await expect(await page.findByRole('alert')).toHaveTextContent('origin has no branch feature/find-a-pr')
    await expect(page.getByRole('dialog')).toBeVisible()
  },
}

/** Escape closes and gives focus back to what opened it. */
export const Escape: Story = {
  render: () => <Example startOpen={false} />,
  play: async () => {
    const page = within(document.body)
    const opener = page.getByRole('button', { name: 'Run a branch' })
    await userEvent.click(opener)
    await expect(await page.findByRole('combobox')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).toBeNull())
    await expect(opener).toHaveFocus()
  },
}

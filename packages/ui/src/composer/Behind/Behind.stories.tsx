import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { Composer } from '../Composer/Composer'
import type { RunningProcess } from '../Running/Running'
import { Behind, type BehindHolder, type BehindProps, type ListenSource } from './Behind'

const SITE: RunningProcess = {
  id: 'site',
  name: 'Site dev server',
  command: 'cd /Users/balazs/Charrette/althar/site/althar && node_modules/.bin/vp dev --config ../../a/vite.config.ts 2>&1 | tail -20',
  label: 'vp dev',
  url: 'localhost:5173',
  since: '41m',
}
const STORYBOOK: RunningProcess = {
  id: 'sb',
  name: 'Storybook',
  command: 'bun run storybook --port 6116',
  url: 'localhost:6116',
  since: '22m',
}
const WATCH: RunningProcess = { id: 'watch', name: 'Type check, watching', command: 'bunx tsc --noEmit --watch', since: '18m' }
const TESTS: RunningProcess = { id: 'tests', name: 'Site tests', command: 'bun run test', since: '9m ago', exited: 1 }
/** What ran and finished well: a build, a type check, a lint. */
const FINISHED: readonly RunningProcess[] = ['Build the site', 'Type check', 'Lint'].map((name, at) => ({
  id: `done-${at}`,
  name,
  command: `bun run ${name.toLowerCase().replaceAll(' ', '-')}`,
  since: `${30 - at * 4}m ago`,
  exited: 0,
}))

const PR: ListenSource = {
  id: 'pr',
  mark: Brand.GitHub,
  label: 'PR #317',
  where: 'charrette/althar',
  what: 'review comments and checks',
  last: '4m',
}
const PR2: ListenSource = { ...PR, id: 'pr2', label: 'PR #321', last: undefined }

/** The screenshot's: six tasks hold the places, one only by a server it left running. */
const HOLDERS: readonly BehindHolder[] = [
  { id: 't1', title: 'Plan usage (#218): every agent, steer work, and prototypes' },
  { id: 't2', title: 'Rules: read quoted heredocs as text; say Althar refused' },
  { id: 't3', title: 'Lead sandbox: known commands and hosts allowed up front' },
  { id: 't4', title: 'Dark mode: a warm dark theme and Light/Dark/Match the Mac', keptBy: ['Dark mode preview'], stoppable: true },
  { id: 't5', title: 'Clean up finished tasks’ folders' },
  { id: 't6', title: 'Automations: a tab, cards, and their own page' },
]
const WAIT = { place: '2nd in Up next', holders: HOLDERS }

/** On a composer's edge, where it floats, at a width: it narrows with the composer. */
const Edge = ({ width = 640, ...props }: BehindProps & { readonly width?: number }) => (
  <div style={{ width, paddingTop: 640 }}>
    <Composer value="" onChange={() => {}} onSubmit={() => {}} placeholder="Tell the lead" above={<Behind {...props} />} />
  </div>
)

const meta = {
  title: 'Composer/Behind',
  component: Behind,
  args: { onStop: fn(), onDismiss: fn(), onOutput: fn(), onOpenUrl: fn(), onStopHeld: fn(), onFront: fn(), onStopListening: fn() },
  render: (args) => <Edge {...args} />,
} satisfies Meta<typeof Behind>
export default meta
type Story = StoryObj<typeof meta>

/** Waiting in Up next: why, in a few words; who holds the places opens from it. */
export const Waiting: Story = {
  args: { wait: WAIT, processes: [SITE, ...FINISHED], sources: [PR] },
  play: async ({ canvasElement, args }) => {
    const chip = within(canvasElement).getByRole('button', { name: /^Waiting for a place, 2nd in Up next/ })
    // Every task's title isn't on the chip; what finished well isn't counted.
    await expect(chip).not.toHaveTextContent('Plan usage')
    await expect(chip).not.toHaveTextContent('finished')
    await userEvent.click(chip)
    const page = within(document.body)
    await expect(await page.findByText('6 tasks are running; 1 of them only for a server it left running.')).toBeVisible()
    await expect(page.getByText('Only its Dark mode preview keeps the place')).toBeVisible()
    await userEvent.click(
      page.getByRole('button', { name: 'Stop what Dark mode: a warm dark theme and Light/Dark/Match the Mac left running' }),
    )
    await expect(args.onStopHeld).toHaveBeenCalledWith('t4')
    await userEvent.click(page.getByRole('button', { name: 'Move to the front of the line' }))
    await expect(args.onFront).toHaveBeenCalled()
  },
}
/** Next in line, with nothing running and no pull request: the wait alone. */
export const OnlyWaiting: Story = { args: { wait: { place: 'Next in Up next', holders: HOLDERS.slice(0, 2) }, onFront: undefined } }
/** Every place held only by a server its task left running: each can be stopped from here. */
export const HeldByServers: Story = {
  args: {
    wait: { place: '2nd in Up next', holders: HOLDERS.map((holder) => ({ ...holder, keptBy: ['Preview server'], stoppable: true })) },
    defaultOpen: true,
  },
}

/** At work, with a server it left running and the pull request it listens to. */
export const Running: Story = {
  args: { processes: [SITE, ...FINISHED], sources: [PR] },
  play: async ({ canvasElement, args }) => {
    const chip = within(canvasElement).getByRole('button', { name: 'Site dev server, localhost:5173 · Listening to PR #317' })
    await userEvent.click(chip)
    const page = within(document.body)
    // What finished well folds away under a line, to show or clear.
    await expect(page.queryByText('Build the site')).toBeNull()
    await userEvent.click(await page.findByRole('button', { name: '3 finished · Show' }))
    await expect(page.getByText('Build the site')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Clear them' }))
    await expect(args.onDismiss).toHaveBeenCalledTimes(3)
    await userEvent.click(page.getByRole('button', { name: 'Stop Site dev server' }))
    await expect(args.onStop).toHaveBeenCalledWith('site')
    await userEvent.click(page.getByRole('button', { name: 'Stop listening to PR #317' }))
    await expect(args.onStopListening).toHaveBeenCalledWith('pr')
  },
}
/** Several running, two pull requests, a failed exit, and waiting: still one chip, one popover. */
export const Several: Story = {
  args: { wait: WAIT, processes: [SITE, STORYBOOK, WATCH, TESTS, ...FINISHED], sources: [PR, PR2] },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole('button', { name: /3 running, 1 failed · Listening to 2 sources$/ })
    await expect(chip).toHaveTextContent('3 running')
  },
}
/** Nothing runs any more, and one failed: it is named, in red. */
export const OnlyFailed: Story = {
  args: { processes: [TESTS, ...FINISHED] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Site tests exited 1' })).toHaveTextContent('Site tests exited 1')
  },
}
/** Everything finished well, and nothing else to say: no chip. */
export const AllFinished: Story = {
  args: { processes: FINISHED },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: /finished|Ran/ })).toBeNull()
  },
}
/** A long name and address give way; the pull request keeps its label. */
export const LongNames: Story = {
  args: {
    processes: [
      {
        ...SITE,
        name: 'Marketing site’s preview server, with the bento animations and the new pricing page',
        url: 'althar-landing-preview.localhost:51730/features/bento',
      },
    ],
    sources: [{ ...PR, where: 'charrette-studio/althar-marketing-site-and-documentation' }],
  },
}
/** A narrow window: where it stands and where it answers go. */
export const Narrow: Story = {
  args: { wait: WAIT, processes: [SITE, STORYBOOK, TESTS], sources: [PR, PR2] },
  render: (args) => <Edge {...args} width={440} />,
}
/** Narrower still: the wait in words, the rest by its glyphs, the whole on hover and to a screen reader. */
export const Narrowest: Story = {
  args: { wait: WAIT, processes: [SITE, STORYBOOK, TESTS], sources: [PR, PR2] },
  render: (args) => <Edge {...args} width={320} />,
}
/** Something arrives: the source's part says it for a moment, and so does a screen reader. */
export const Heard: Story = {
  args: { processes: [SITE], sources: [PR], arrivalFor: Number.POSITIVE_INFINITY },
  render: function Render(args) {
    const [heard, setHeard] = useState<BehindProps['heard']>(null)
    return (
      <>
        <button type="button" onClick={() => setHeard({ key: 1, text: 'dana commented on PR #317' })}>
          Arrive
        </button>
        <Edge {...args} heard={heard} />
      </>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Arrive' }))
    await waitFor(() => expect(c.getAllByText('dana commented on PR #317')).toHaveLength(2))
  },
}

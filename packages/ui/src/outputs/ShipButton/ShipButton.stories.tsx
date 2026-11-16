import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ShipFar, ShipStop } from '../../foundations/vocabulary'
import { States, statesParameters } from '../../storybook/States'
import { type ShipAbout, ShipButton, type ShipButtonProps, ShipGuide, type ShipRoute } from './ShipButton'

const ABOUT: ShipAbout = { commits: '2 commits', to: 'PR #820', reviewer: 'GPT-6.1 Sol', theirs: false }
const READY: ShipRoute = { review: true, far: ShipFar.Ready }

/** As a card holds it: its route kept here, as the window keeps the one chosen for this Ship. */
function Held(props: Omit<ShipButtonProps, 'route' | 'onRoute'> & { route?: ShipRoute; onRoute?: (route: ShipRoute) => void }) {
  const [route, setRoute] = useState(props.route ?? READY)
  return (
    <div style={{ width: 300 }}>
      <ShipButton
        {...props}
        route={route}
        onRoute={(next) => {
          setRoute(next)
          props.onRoute?.(next)
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Outputs/ShipButton',
  component: Held,
  args: { about: ABOUT, onShip: fn(), onRoute: fn(), onMakeDefault: fn(), defaultRoute: { review: true, far: ShipFar.Merge } },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 420, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Held>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
/** All the way: the review, the push, ready and merged. */
export const ToMerged: Story = { args: { route: { review: true, far: ShipFar.Merge } } }
/** No review, as far as a push: only the push lit. */
export const PushOnly: Story = { args: { route: { review: false, far: ShipFar.Push } } }
/** Its pull request is ready for review already: Ready stays lit, and Push isn't offered as how far. */
export const ReadyAlready: Story = { args: { readyAlready: true, route: { review: true, far: ShipFar.Push } } }
/** No reviewer on the task: Review first stays off. */
export const NoReviewer: Story = { args: { reviewable: false, route: { review: false, far: ShipFar.Ready } } }
/** Main needs someone else's approval: it stops at Ready, and the menu says why. */
export const Bent: Story = {
  args: { about: { ...ABOUT, theirs: true }, note: 'Main here needs an approval from someone else, so it stops at Ready for review.' },
}
export const Disabled: Story = { args: { disabled: true } }
/** Under way, at each stop: greyed where it was, its route kept, the stop it is at in bold. */
export const Reviewing: Story = {
  args: {
    onShip: undefined,
    onSkipReview: fn(),
    underWay: { label: 'Reviewing', at: ShipStop.Review },
    route: { review: true, far: ShipFar.Merge },
  },
}
export const Pushing: Story = {
  args: { onShip: undefined, underWay: { label: 'Pushing 2 commits', at: ShipStop.Push }, route: { review: true, far: ShipFar.Merge } },
}
export const MarkingReady: Story = {
  args: { onShip: undefined, underWay: { label: 'Marking ready', at: ShipStop.Ready }, route: { review: true, far: ShipFar.Merge } },
}
export const WaitingToMerge: Story = {
  args: {
    onShip: undefined,
    underWay: { label: 'Merges once checks pass', at: ShipStop.Merge },
    route: { review: true, far: ShipFar.Merge },
  },
}
export const LongLabel: Story = {
  args: {
    onShip: undefined,
    underWay: { label: 'Fixing what the review found', at: ShipStop.Review },
    route: { review: true, far: ShipFar.Merge },
  },
}

/** The chevron sets the route for this Ship: its line follows at once. */
export const SetsTheRoute: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'How far it goes' }))
    const page = within(document.body)
    await userEvent.click(await page.findByRole('menuitemcheckbox', { name: /Review first/ }))
    await expect(args.onRoute).toHaveBeenLastCalledWith({ review: false, far: ShipFar.Ready })
    await userEvent.click(page.getByRole('menuitemradio', { name: /Merged/ }))
    await expect(args.onRoute).toHaveBeenLastCalledWith({ review: false, far: ShipFar.Merge })
    await expect(canvas.getByLabelText('push, then ready, then merge')).toBeInTheDocument()
  },
}

/** Pressed: it ships on its route, once. */
export const Ships: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Ship/ }))
    await expect(args.onShip).toHaveBeenCalledTimes(1)
  },
}

/** Under way, pressing it does nothing; its menu skips the review instead. */
export const UnderWayMenu: Story = {
  args: Reviewing.args,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Reviewing/ }))
    await userEvent.click(canvas.getByRole('button', { name: 'How far it goes' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: /Skip the review/ }))
    await expect(args.onSkipReview).toHaveBeenCalledTimes(1)
  },
}

/** How Ship works, from the menu: a click on a stop's icon turns it off, and the dialog ends on the Ship that route makes. */
export const GuideEdits: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'How far it goes' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'How Ship works' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await expect(dialog.getByRole('button', { name: 'Got it' })).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Skip Review this time' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Skip Ready this time' }))
    await expect(args.onRoute).toHaveBeenLastCalledWith({ review: false, far: ShipFar.Push })
    await userEvent.click(dialog.getByRole('button', { name: 'Push 2 commits' }))
    await expect(args.onShip).toHaveBeenCalledTimes(1)
  },
}

/** No reviewer: How Ship works keeps its Review stop off, saying why, so the dialog can't promise one. */
export const GuideNoReviewer: Story = {
  args: NoReviewer.args,
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'How far it goes' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'How Ship works' }))
    const dialog = within(await within(document.body).findByRole('dialog'))
    await expect(dialog.queryByRole('button', { name: 'Bring Review back' })).toBeNull()
    await expect(dialog.getByTitle('This task has no reviewer')).toBeVisible()
    await expect(dialog.getByText('This task has no reviewer, so the 2 commits go up as they are.')).toBeVisible()
    // The other stops still change.
    await userEvent.click(dialog.getByRole('button', { name: 'Bring Merge back' }))
    await expect(args.onRoute).toHaveBeenLastCalledWith({ review: false, far: ShipFar.Merge })
  },
}

export const Guide: StoryObj<typeof ShipGuide> = {
  render: () => <ShipGuide route={READY} about={{ ...ABOUT, theirs: true }} onRoute={fn()} onShip={fn()} onClose={fn()} />,
}

export const GuideReadOnly: StoryObj<typeof ShipGuide> = {
  render: () => <ShipGuide route={{ review: true, far: ShipFar.Merge }} about={ABOUT} onClose={fn()} />,
}

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...['rest', 'hover', 'focus', 'pressed'].map((state) => ({ state, node: <Held {...args} /> })),
        { state: 'To merged', node: <Held {...args} route={{ review: true, far: ShipFar.Merge }} /> },
        { state: 'Push only', node: <Held {...args} route={{ review: false, far: ShipFar.Push }} /> },
        { state: 'Ready already', node: <Held {...args} readyAlready route={{ review: true, far: ShipFar.Push }} /> },
        { state: 'Disabled', node: <Held {...args} disabled /> },
        ...(
          [
            ['Reviewing', ShipStop.Review],
            ['Pushing 2 commits', ShipStop.Push],
            ['Marking ready', ShipStop.Ready],
            ['Merges once checks pass', ShipStop.Merge],
          ] as const
        ).map(([label, at]) => ({
          state: label,
          node: <Held {...args} onShip={undefined} underWay={{ label, at }} route={{ review: true, far: ShipFar.Merge }} />,
        })),
      ]}
    />
  ),
}

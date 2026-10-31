import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SHOT_AFTER, SHOT_BEFORE, SHOT_RUN } from '../../fixtures/shots'
import { States, statesParameters } from '../../storybook/States'
import { PostScreenshots, type PostScreenshotsShot } from './PostScreenshots'

const SHOTS: PostScreenshotsShot[] = [
  { ...SHOT_BEFORE, key: 'refund-form', caption: 'A1 · The refund form, a key reused: the reason under the button' },
  { ...SHOT_AFTER, key: 'refund-again', caption: 'A2 · The same refund, sent again: refused, with a link to the first' },
  ...SHOT_RUN.slice(0, 2).map((shot, i) => ({
    ...shot,
    key: `refunds-${i}`,
    caption: `B${i + 1} · The refunds list, ${shot.label ?? ''}`,
  })),
]

const MANY: PostScreenshotsShot[] = Array.from({ length: 12 }, (_, i) => {
  const shot = [SHOT_BEFORE, SHOT_AFTER, ...SHOT_RUN][i % (SHOT_RUN.length + 2)] ?? SHOT_AFTER
  return {
    ...shot,
    id: `many-${i}`,
    key: `view-${i}`,
    caption: `${String.fromCharCode(65 + Math.floor(i / 4))}${(i % 4) + 1} · A view of the refunds, ${i + 1} of 12`,
  }
})

/* where it sits: at the end of a heading row, at the Outputs column's width */
const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', width: 640, minHeight: 360 }}>
    <span style={{ font: '500 10.5px/1 var(--font-label)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--t-3)' }}>
      What it looks like
    </span>
    {children}
  </div>
)

const meta = {
  title: 'Outputs/PostScreenshots',
  component: PostScreenshots,
  decorators: [
    (Story, { parameters }) =>
      parameters.bare === true ? (
        <Story />
      ) : (
        <Row>
          <Story />
        </Row>
      ),
  ],
  args: {
    standing: 'unposted',
    pullRequest: 'PR #142',
    shots: SHOTS,
    leftOut: [],
    destination: 'a comment on acme/web #142',
    host: 'GitHub',
    onPost: fn(),
  },
} satisfies Meta<typeof PostScreenshots>
export default meta
type Story = StoryObj<typeof meta>

/** Not on the pull request yet. */
export const Unposted: Story = {}
/** On the pull request, and nothing has changed since. */
export const Posted: Story = { args: { standing: 'posted', commentUrl: 'https://github.com/acme/web/pull/142#issuecomment-1' } }
/** Two screenshots differ from what the pull request shows. */
export const Changed: Story = {
  args: { standing: 'changed', changed: 2, commentUrl: 'https://github.com/acme/web/pull/142#issuecomment-1' },
}
/** The project keeps the comment up to date itself. */
export const Synced: Story = { args: { standing: 'synced', commentUrl: 'https://github.com/acme/web/pull/142#issuecomment-1' } }
/** One left out of this pull request: said quietly on the line, and unticked in the sheet. */
export const LeftOut: Story = {
  args: { standing: 'posted', leftOut: ['refunds-1'], commentUrl: 'https://github.com/acme/web/pull/142#issuecomment-1' },
}

/** The sheet: what goes where, each screenshot ticked or left out, and the press beside the comment's link. */
export const Open: Story = {
  args: { standing: 'changed', changed: 2, leftOut: ['refunds-1'], commentUrl: 'https://github.com/acme/web/pull/142#issuecomment-1' },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Update PR #142 · 2 changed · 1 left out' }))
    const sheet = within(canvasElement.ownerDocument.body)
    const boxes = await sheet.findAllByRole('checkbox')
    await expect(boxes).toHaveLength(4)
    await expect(sheet.getByRole('checkbox', { name: /^Include B2/ })).not.toBeChecked()
    await userEvent.click(sheet.getByRole('checkbox', { name: /^Include A2/ }))
    await userEvent.click(sheet.getByRole('button', { name: 'Update PR #142' }))
    await expect(args.onPost).toHaveBeenCalledWith(['refund-again', 'refunds-1'])
  },
}
/** Posting: the press says so, and ignores more. */
export const Posting: Story = { args: { defaultOpen: true, posting: true } }
/** It didn't go: why, above the foot, and the press again. */
export const Failed: Story = {
  args: { defaultOpen: true, standing: 'changed', changed: 1, error: 'GitHub didn’t answer. Nothing was posted.' },
}
/** Twelve screenshots: four across, and the grid scrolls past three rows. */
export const Many: Story = { args: { defaultOpen: true, shots: MANY, leftOut: ['view-3', 'view-7'] } }

export const AllStates: Story = {
  parameters: { ...statesParameters, bare: true },
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'unposted', node: <PostScreenshots {...args} /> },
        { state: 'posted', node: <PostScreenshots {...args} standing="posted" /> },
        { state: 'changed', node: <PostScreenshots {...args} standing="changed" changed={2} /> },
        { state: 'synced', node: <PostScreenshots {...args} standing="synced" /> },
        { state: 'left out', node: <PostScreenshots {...args} standing="posted" leftOut={['refunds-1']} /> },
        { state: 'hover', node: <PostScreenshots {...args} /> },
        { state: 'focus', node: <PostScreenshots {...args} /> },
        { state: 'pressed', node: <PostScreenshots {...args} /> },
      ]}
    />
  ),
}

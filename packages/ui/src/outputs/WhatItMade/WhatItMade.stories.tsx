import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { EvidenceKind } from '../../foundations/vocabulary'
import { SHOT_AFTER, SHOT_BEFORE, SHOT_RUN } from '../../fixtures/shots'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { PostScreenshots } from '../PostScreenshots/PostScreenshots'
import type { GalleryShot } from '../../thread/Gallery/Gallery'
import { WhatItMade } from './WhatItMade'

const STORY = {
  lede: 'Reusing a refund’s idempotency key with a different amount now answers **409 Conflict**, saying which refund the key belongs to, instead of quietly refunding twice.',
  rest: 'The key is checked before the payment provider is called, so nothing reaches it twice.\n\nKeys are kept for 24 hours, as the provider keeps its own.',
}

const SHOTS: GalleryShot[] = [
  { ...SHOT_BEFORE, caption: 'A1 · The refund form, a key reused: the reason under the button' },
  { ...SHOT_AFTER, caption: 'A2 · The same refund, sent again: refused, with a link to the first' },
  ...SHOT_RUN.map((shot, i) => ({ ...shot, caption: `B${i + 1} · The refunds list, step ${i + 1}` })),
]

const meta = {
  title: 'Outputs/WhatItMade',
  component: WhatItMade,
  decorators: [threadDecorator],
  args: {
    story: STORY,
    shots: SHOTS.slice(0, 2),
    checked: [
      {
        id: 'tests',
        kind: EvidenceKind.TestRun,
        caption: 'The refund tests, with the new refused case',
        form: 'output',
        command: 'bun run test refunds',
        exit: 0,
        lines: [' ✓ refunds a paid order', ' ✓ refuses a reused key', '', '      Tests  2 passed (2)'],
      },
    ],
    unverified: ['Not tried against the provider’s sandbox: no keys here'],
  },
} satisfies Meta<typeof WhatItMade>
export default meta
type Story = StoryObj<typeof meta>

/** What it is, its pictures, then what it couldn't check before what it did. */
export const Change: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const heads = c
      .getAllByText(/^(What changed|What it looks like|Not checked|What it checked)$/)
      .map((one) => one.textContent?.replace(/\d+$/, ''))
    await expect(heads.join(' / ')).toBe('What changed / What it looks like / Not checked / What it checked')
    await expect(c.queryByText(/nothing reaches it twice/)).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Read all of it' }))
    await expect(c.getByText(/nothing reaches it twice/)).toBeInTheDocument()
  },
}
/** One picture: as wide as the column lets it be. */
export const OnePicture: Story = { args: { shots: SHOTS.slice(1, 2) } }
/** Many pictures, two across. */
export const ManyPictures: Story = { args: { shots: SHOTS } }
/** A lead that sent 76 pictures, each its own view: the first six, the rest a press away, and all of them a key away full size. */
export const SeventySixPictures: Story = {
  args: {
    shots: Array.from({ length: 76 }, (_, i) => ({
      ...(SHOTS[i % SHOTS.length] as GalleryShot),
      id: `shot-${i}`,
      caption: `${String.fromCharCode(65 + Math.floor(i / 8))}${(i % 8) + 1} · A view of the refunds, ${i + 1} of 76`,
    })),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByRole('button', { name: /full size$/ })).toHaveLength(6)
    await userEvent.click(c.getByRole('button', { name: 'Show all 76' }))
    await expect(c.getAllByRole('button', { name: /full size$/ })).toHaveLength(76)
    await userEvent.click(c.getByRole('button', { name: 'Show fewer' }))
    await expect(c.getAllByRole('button', { name: /full size$/ })).toHaveLength(6)
  },
}
/** Nothing to look at: what it is, and what it checked. */
export const NoPictures: Story = { args: { shots: [] } }
/** Its lead said nothing of what it is: its pictures lead. */
export const PicturesOnly: Story = { args: { story: null, checked: [], unverified: [] } }
/** What can be done with the pictures, at the end of their heading's row: here, posting them to the pull request. */
export const WithPostScreenshots: Story = {
  args: {
    shots: SHOTS.slice(0, 4),
    looksAction: (
      <PostScreenshots
        standing="changed"
        changed={2}
        pullRequest="PR #142"
        shots={SHOTS.slice(0, 4).map((shot) => ({ ...shot, key: shot.id }))}
        leftOut={['state-1']}
        destination="a comment on acme/web #142"
        host="GitHub"
        commentUrl="https://github.com/acme/web/pull/142#issuecomment-1"
        onPost={() => {}}
      />
    ),
  },
}

import { Fragment, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'

import { SHOT_AFTER, SHOT_BEFORE } from '../../fixtures/shots'
import { Gallery } from '../Gallery/Gallery'
import { Composer } from '../../composer/Composer/Composer'
import { TaskFace } from '../TaskFace/TaskFace'
import { Thread } from '../Thread/Thread'
import { Prose, Turn } from '../Turn/Turn'
import { You } from '../You/You'

const meta = {
  title: 'Thread/ThreadNavigator',
  component: TaskFace,
  args: { children: null, composer: null },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TaskFace>
export default meta
type Story = StoryObj<typeof meta>

const messages = [
  [
    'Match refunds to the charge rate limit.',
    'Refunds now share the partner budget. A refused request returns 429 and a Retry-After header.',
  ],
  ['What happens when the partner retries?', 'The existing idempotency key returns the saved result. No second refund is issued.'],
  [
    'Check refunds made before the migration.',
    'The dry run found 18,402 refunds. Each can be backfilled without changing its amount or status.',
  ],
  [
    'Keep the rollout gradual.',
    'The backfill runs in batches, and the cursor is saved after each successful batch. It can resume after a restart.',
  ],
  [
    'Review the dashboard at a narrow width.',
    'The table stays inside the page. The refund details open beside the conversation and can be closed with Escape.',
  ],
  [
    'Write down the recovery steps.',
    'The reference includes how to pause, resume and verify the backfill, with commands and the expected output.',
  ],
  [
    'Run the checks before opening the pull request.',
    'The refund checks pass. The pull request includes the changes to the shared limiter and its reference.',
  ],
  ['Show me the final result.', 'The rate limit is shared, retries are safe, and the backfill resumes from its last completed batch.'],
]

function Example({ crowded = false, pictures, width }: { crowded?: boolean; pictures?: 'one' | 'pair'; width?: number }) {
  const [draft, setDraft] = useState('')
  return (
    <div style={{ height: '100vh', ...(crowded || width !== undefined ? { width: width ?? 380, maxWidth: '100%' } : {}) }}>
      <TaskFace composer={<Composer value={draft} onChange={setDraft} onSubmit={() => {}} placeholder="Tell the lead" />}>
        <Thread label="Conversation">
          {Array.from({ length: crowded ? 48 : 8 }, (_, i) => (
            <Fragment key={i}>
              <You>{messages[i % messages.length]?.[0]}</You>
              <Turn voice="Althar">
                <Prose>{messages[i % messages.length]?.[1]}</Prose>
                {pictures !== undefined && i === 3 && (
                  <Gallery
                    data-testid="wide-gallery"
                    shots={(pictures === 'one' ? [SHOT_AFTER] : [SHOT_BEFORE, SHOT_AFTER]).map((shot) => ({
                      ...shot,
                      caption: shot.label ?? shot.name,
                    }))}
                  />
                )}
              </Turn>
            </Fragment>
          ))}
        </Thread>
      </TaskFace>
    </div>
  )
}

export const Conversation: Story = { render: () => <Example /> }
export const Crowded: Story = { render: () => <Example crowded /> }

/** Wide media never runs beneath the navigation marks. Layout needs a real browser. */
const clearOfPictures: NonNullable<Story['play']> = async ({ canvasElement }) => {
  const c = within(canvasElement)
  const gallery = c.getByTestId('wide-gallery')
  const images = Array.from(gallery.querySelectorAll('img'))
  const nav = await c.findByRole('navigation', { name: 'Conversation navigation' })
  gallery.scrollIntoView({ block: 'center' })
  await waitFor(async () => {
    await expect(images.length).toBeGreaterThan(0)
    for (const image of images) await expect(image.getBoundingClientRect().right).toBeLessThan(nav.getBoundingClientRect().left)
  })
}

export const WithScreenshot: Story = { render: () => <Example pictures="one" />, play: clearOfPictures }
export const WithScreenshots: Story = { render: () => <Example pictures="pair" />, play: clearOfPictures }
export const WithScreenshotsInNarrowPane: Story = { render: () => <Example pictures="pair" width={520} />, play: clearOfPictures }

import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SaveToRepo } from './SaveToRepo'

/* Save to repo: the project's place, the first save, somewhere else from the tree, saved, and a save that failed. */

const meta = {
  title: 'Thread/Canvas/Save to repo',
  component: SaveToRepo,
  args: {
    title: 'Gift a class',
    name: 'gift-a-class',
    version: 3,
    repositories: [
      { id: 'repo_kiln', name: 'kiln' },
      { id: 'repo_design', name: 'kiln-design' },
    ],
    place: { repositoryId: 'repo_kiln', repository: 'kiln', folder: 'design/', why: null },
    first: false,
    rule: 'A pull request of its own, a commit each version',
    saved: null,
    folders: ['apps/', 'apps/web/', 'apps/web/src/', 'design/', 'design/calmer-checkout/', 'docs/', 'docs/flows/'],
    onRepository: fn(),
    onSave: fn(),
    onStop: fn(),
    onSettings: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420, borderRadius: 12, background: 'var(--float)', boxShadow: 'var(--lift-pop)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SaveToRepo>

export default meta
type Story = StoryObj<typeof meta>

/** The project's place, the folder named in place, and Save. */
export const AtThePlace: Story = {}

/** The project's first save: Althar's pick, with why, which becomes the place. */
export const FirstSave: Story = {
  args: { first: true, place: { repositoryId: 'repo_kiln', repository: 'kiln', folder: 'design/', why: 'Where kiln keeps its designs' } },
}

/** Somewhere else: the repository's folders as a tree, the new folder where it would land. */
export const SomewhereElse: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Somewhere else' }))
    await userEvent.click(c.getByRole('treeitem', { name: 'docs' }))
    await expect(c.getByRole('switch')).not.toBeChecked()
  },
}

/** Saved, with a newer version to commit, its pull request linked. */
export const Saved: Story = {
  args: {
    saved: {
      repositoryId: 'repo_kiln',
      repository: 'kiln',
      path: 'design/gift-a-class/',
      version: 2,
      commit: 'abc1234def',
      pullRequest: { number: 12, url: 'https://github.com/kiln/kiln/pull/12' },
      state: 'saved',
      problem: null,
    },
  },
}

/** A save that failed, with what to do, and Try again. */
export const Failed: Story = {
  args: {
    saved: {
      repositoryId: 'repo_kiln',
      repository: 'kiln',
      path: 'design/gift-a-class/',
      version: null,
      commit: null,
      pullRequest: null,
      state: 'failed',
      problem: 'kiln’s main is protected: save it in a pull request of its own instead.',
    },
  },
}

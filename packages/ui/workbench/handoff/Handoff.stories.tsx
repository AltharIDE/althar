import type { Meta, StoryObj } from '@storybook/react-vite'

import { HandoffWindow } from './Window'

/*
 * Product and design lenses, and the handoff between them (README.md): Saved
 * carts from its spec being written to its design going into a pull request.
 * Each story is a moment; everything in it can be pressed, and the lens chip
 * switches the lens. Light and dark from the toolbar.
 */

const meta = {
  title: 'Workbench/Handoff',
  component: HandoffWindow,
  parameters: { layout: 'fullscreen' },
  args: {
    scene: 'spec',
    role: 'product',
    roles: ['product', 'design'],
    picking: false,
    firstRun: false,
    menu: false,
    opened: false,
    accepted: false,
    asked: false,
    answered: false,
  },
  argTypes: {
    scene: { control: 'inline-radio', options: ['spec', 'handoff', 'ask', 'feature', 'design'] },
    role: { control: 'inline-radio', options: ['product', 'design', 'engineering', 'devops'] },
  },
} satisfies Meta<typeof HandoffWindow>
export default meta
type Story = StoryObj<typeof meta>

/** 1 · Opening storefront the first time: which roles you have here, several allowed. */
export const ChoosingRoles: Story = { args: { picking: true, firstRun: true } }
/** 1 · Switching lens later: your roles first, every other lens a press away. */
export const SwitchingLens: Story = { args: { scene: 'feature', role: 'design', menu: true } }
/** 2 · The coordinator drafted spec.md from SHOP-212; product reads it with its frontmatter as the head. */
export const SpecDraft: Story = { args: { scene: 'spec' } }
/** 2 · Opened: its pull request is Spec's artefact, with the host's gates. */
export const SpecPullRequest: Story = { args: { scene: 'spec', opened: true } }
/** 3 · The spec merged: design's inbox has the handoff, and the tasks their coordinator proposed, held. */
export const Handoff: Story = { args: { scene: 'handoff', role: 'design' } }
/** 3 · Accepted: the tasks run. */
export const HandoffAccepted: Story = { args: { scene: 'handoff', role: 'design', accepted: true } }
/** 4 · Design asks Product, without moving the stage. */
export const AskingBack: Story = { args: { scene: 'ask', role: 'design' } }
/** 4 · Asked: it waits on Product, and design's work carries on. */
export const AskedWaiting: Story = { args: { scene: 'ask', role: 'design', asked: true } }
/** 4 · Product sees the question, and answers. */
export const ProductAnswers: Story = { args: { scene: 'ask', role: 'product', asked: true } }
/** 4 · Answered, with a spec fix; still in Design. */
export const Answered: Story = { args: { scene: 'ask', role: 'product', asked: true, answered: true } }
/** 5 · The feature page: stages, artefacts, pull requests, the host's gates, and who it waits on. */
export const FeaturePage: Story = { args: { scene: 'feature', role: 'product' } }
/** 6 · Design's lens: canvases and screenshot diffs beside the feature, and design/ in a pull request. */
export const DesignLens: Story = { args: { scene: 'design', role: 'design' } }

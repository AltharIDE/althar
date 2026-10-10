import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { EDGE_NEEDS, EDGE_WORK, type EdgeDemoCall, edgeLineOf } from '../../fixtures/edge'
import { AskAnswered, AskNote } from '../../primitives/Ask/Ask'
import { EdgeSheet } from './EdgeSheet'
import s from './EdgeSheet.stories.module.css'

const lineOf = (call: EdgeDemoCall) => edgeLineOf(call, fn())

const needs = EDGE_NEEDS.map(lineOf)

const meta = {
  title: 'Home/EdgeSheet',
  component: EdgeSheet,
  decorators: [(Story) => <div className={s.paper}>{Story()}</div>],
  args: { waiting: needs.length, needs, work: EDGE_WORK, onOpenApp: fn() },
} satisfies Meta<typeof EdgeSheet>
export default meta
type Story = StoryObj<typeof meta>

/** Under Althar's item in the menu bar: what needs you, and the work in progress in one line. */
export const Paper: Story = {}

/** In the island, the notch's black. */
export const Ink: Story = {
  args: { tone: 'ink' },
  decorators: [(Story) => <div className={s.ink}>{Story()}</div>],
}

/** Nothing waits on you: it says so, over the work's line. */
export const NothingWaits: Story = { args: { waiting: 0, needs: [] } }

/** Nothing at all: it says so, and still opens Althar. */
export const NothingAtAll: Story = { args: { waiting: 0, needs: [], work: { inProgress: 0 } } }

/** Work held and stopped: the foot says how many of each, and nothing more. */
export const HeldAndStopped: Story = { args: { work: { inProgress: 6, held: 2, stopped: 1 } } }

/** A call just answered here folds to a line, as on the home. */
export const JustAnswered: Story = {
  args: {
    waiting: 1,
    needs: [
      <AskAnswered key="h212" said="Allowed npm publish --tag next --access public">
        <AskNote>in Halyard</AskNote>
      </AskAnswered>,
      needs[1],
    ],
  },
}

/** An answer that didn't go through: the call is back, and the sheet says why first. */
export const AnswerFailed: Story = { args: { failure: 'Althar’s runtime didn’t answer. If it keeps happening, restart Althar.' } }

/** Without a way into the app, the head only counts. */
export const WithoutWayIn: Story = { args: { onOpenApp: undefined } }

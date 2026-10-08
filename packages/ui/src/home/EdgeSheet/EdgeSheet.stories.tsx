import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { EDGE_NEEDS, EDGE_WORK, type EdgeDemoRow, edgeRowOf } from '../../fixtures/edge'
import { AskAnswered, AskNote } from '../../primitives/Ask/Ask'
import { EdgeSheet } from './EdgeSheet'
import s from './EdgeSheet.stories.module.css'

const rowOf = (row: EdgeDemoRow) => edgeRowOf(row, fn())

const needs = EDGE_NEEDS.map(rowOf)
const work = EDGE_WORK.map(rowOf)

const meta = {
  title: 'Home/EdgeSheet',
  component: EdgeSheet,
  decorators: [(Story) => <div className={s.paper}>{Story()}</div>],
  args: { waiting: needs.length, working: work.length, needs, work, onOpenApp: fn() },
} satisfies Meta<typeof EdgeSheet>
export default meta
type Story = StoryObj<typeof meta>

/** Under Althar's item in the menu bar: what needs you first, then what is in progress. */
export const Paper: Story = {}

/** In the island, the notch's black. */
export const Ink: Story = {
  args: { tone: 'ink' },
  decorators: [(Story) => <div className={s.ink}>{Story()}</div>],
}

/** Nothing waits on you: that section isn't there at all. */
export const NothingWaits: Story = { args: { waiting: 0, needs: [] } }

/** Nothing at all: it says so, and still opens Althar. */
export const NothingAtAll: Story = { args: { waiting: 0, working: 0, needs: [], work: [] } }

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

/** Without a way into the app, there is no foot. */
export const WithoutFoot: Story = { args: { onOpenApp: undefined } }

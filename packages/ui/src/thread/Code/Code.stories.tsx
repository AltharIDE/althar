import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  decisionFound,
  decisionRead,
  iconsFound,
  limitFn,
  limitsChange,
  limitsFound,
  limitsMissing,
  limitsMoved,
  limitsRead,
  limitsRewritten,
  modelSeveral,
} from '../../fixtures/code'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { SplitButton } from '../../primitives/SplitButton/SplitButton'
import { Markdown } from '../Markdown/Markdown'
import { type CodeShell, ThreadShellProvider } from '../Shell/Shell'
import { TaskFace } from '../TaskFace/TaskFace'
import { Workbench } from '../Workbench/Workbench'
import { type CodeMode, type CodeWhere, firstMode, type FoundCode } from './code'
import { CodePanel, CodePeek } from './CodeView'

const meta = {
  title: 'Thread/Code',
  component: CodePanel,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CodePanel>
export default meta
type Story = StoryObj<typeof meta>

const TASK: CodeWhere = { kind: 'task', branch: 'althar/refund-rate-limits' }
const MAIN: CodeWhere = { kind: 'default', branch: 'main', said: 'yesterday' }

/* The peek, as its popover holds it: a card over the thread. */
function Card({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: 32, background: 'var(--n-2)', minHeight: '100vh' }}>
      <div
        style={{
          width: 620,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 10,
          background: 'var(--paper)',
          boxShadow: 'var(--lift-pop), 0 0 0 1px var(--line-2)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

const editor = { name: 'Cursor', onOpen: fn() }

/** Pointing at a lead's name: the lines it named and five around, what the task changed in the file, and the ways on. */
export const Peek: Story = {
  args: { found: limitsFound, mode: 'now', onMode: fn(), onGo: fn(), onClose: fn() },
  render: () => (
    <Card>
      <CodePeek found={limitsFound} where={TASK} read={limitsRead} editor={editor} onBeside={fn()} onGo={fn()} />
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('this task')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Open in Cursor' })).toBeInTheDocument()
    // Lines 17 to 38: the named ones and five either side, the rest a press away.
    await expect(c.getByRole('button', { name: 'Show all 16: 16 lines above' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: /lines above/ }))
    await expect(c.queryByRole('button', { name: /lines above/ })).not.toBeInTheDocument()
  },
}

/** The coordinator's name, from yesterday, on main: lines were rewritten since, so they show as they were. */
export const PeekAsItWas: Story = {
  args: Peek.args,
  render: () => (
    <Card>
      <CodePeek found={limitsRewritten} where={MAIN} read={limitsRead} editor={editor} onBeside={fn()} onGo={fn()} />
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('as it was when said, yesterday')).toBeInTheDocument()
    await expect(c.getByText(/rewritten since/)).toBeInTheDocument()
  },
}

/** A path the agent got wrong: nothing there, and files of nearly its name, which open beside. */
export const PeekMissing: Story = {
  args: Peek.args,
  render: () => (
    <Card>
      <CodePeek found={limitsMissing} where={TASK} onBeside={fn()} onGo={fn()} editor={editor} />
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('There’s no such file')).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Open in Cursor' })).not.toBeInTheDocument()
  },
}

/* Where the panel lives: the workbench beside the thread. */
const beside: Decorator = (Story) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 480px', height: '100vh', background: 'var(--n-2)' }}>
    <div />
    <Workbench width={480} min={360} max={720} onWidth={() => undefined}>
      <Story />
    </Workbench>
  </div>
)

const actions = (
  <SplitButton
    size="small"
    onClick={fn()}
    moreLabel="Open in another editor"
    menu={(trigger) => (
      <Menu trigger={trigger} label="Open in another editor" align="end">
        <MenuItem onSelect={fn()}>Open in VS Code</MenuItem>
        <MenuItem onSelect={fn()}>Show in Finder</MenuItem>
      </Menu>
    )}
  >
    Open in Cursor
  </SplitButton>
)

/** The panel keeps the way it shows a file per file it opens, as the host does. */
function Stateful({
  found,
  where,
  read = limitsRead,
  back = false,
}: {
  found: FoundCode
  where: CodeWhere
  read?: typeof limitsRead
  back?: boolean
}) {
  const [mode, setMode] = useState<CodeMode>(firstMode(found))
  return (
    <CodePanel
      found={found}
      where={where}
      mode={mode}
      onMode={setMode}
      read={read}
      change={limitsChange}
      actions={actions}
      nav={{ at: 2, of: 5, onStep: fn() }}
      onGo={fn()}
      onClose={fn()}
      {...(back ? { onBack: fn() } : {})}
    />
  )
}

/** The whole file beside the conversation, at the lines named; File or what the task changed in it. */
export const Panel: Story = {
  args: Peek.args,
  decorators: [beside],
  render: () => <Stateful found={limitsFound} where={TASK} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Copy path' })).toBeInTheDocument()
    await expect(c.getByText('2 of 5')).toBeInTheDocument()
    await userEvent.click(c.getByRole('radio', { name: /Change \+41 −3/ }))
    await expect(c.getByRole('group', { name: 'src/refunds/limits.ts' })).toBeInTheDocument()
  },
}

/** On main, named yesterday: when said or now, the lines followed to where they are now. */
export const PanelMoved: Story = {
  args: Peek.args,
  decorators: [beside],
  render: () => <Stateful found={limitsMoved} where={MAIN} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Line 13 then is line 17 now: the file changed above it since.')).toBeInTheDocument()
    await userEvent.click(c.getByRole('radio', { name: 'When said' }))
    await expect(c.queryByText(/then is line/)).not.toBeInTheDocument()
  },
}

/** Opened from the lead's document: on top of it, with the way back. A decision is prose, and wraps. */
export const PanelProse: Story = {
  args: Peek.args,
  decorators: [beside],
  render: () => <Stateful found={decisionFound} where={TASK} read={decisionRead} back />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Back to the document' })).toBeInTheDocument()
  },
}

/** A file's name several files have: each opens here. */
export const PanelSeveral: Story = {
  args: Peek.args,
  decorators: [beside],
  render: () => <Stateful found={modelSeveral} where={TASK} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('button', { name: /model\.ts/ })).toHaveLength(3)
  },
}

/** What isn't text isn't shown; it opens elsewhere. */
export const PanelBinary: Story = {
  args: Peek.args,
  decorators: [beside],
  render: () => <Stateful found={iconsFound} where={TASK} />,
}

const SAID = `The limiter is in \`src/refunds/limits.ts:22-33\`: \`checkRefundLimit\` counts the merchant's refunds since the window opened. I also wrote docs/decisions/012-refund-limits.md. The old path \`src/refund/limit.ts\` is gone, and \`npm test\` passes.`

const FOUND: ReadonlyMap<string, FoundCode> = new Map<string, FoundCode>([
  ['src/refunds/limits.ts:22-33', limitsFound],
  ['checkRefundLimit', limitFn],
  ['docs/decisions/012-refund-limits.md', decisionFound],
  ['src/refund/limit.ts', limitsMissing],
])

/** A lead's message, its names the files they name: a chip for each, a name in code, a path in its words, one that isn't there. */
export const InAMessage: Story = {
  args: Peek.args,
  render: function Render() {
    const [opened, setOpened] = useState<string | null>(null)
    const code: CodeShell = {
      useFound: () => FOUND,
      peek: (found) => <CodePeek found={found} where={TASK} read={limitsRead} onBeside={fn()} onGo={fn()} />,
      open: (found) => setOpened(found.name),
      opened,
      close: () => setOpened(null),
    }
    return (
      <div style={{ padding: 32, maxWidth: 680 }}>
        <ThreadShellProvider value={{ code }}>
          <Markdown source={SAID} />
        </ThreadShellProvider>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const chip = c.getByRole('button', { name: 'Open src/refunds/limits.ts:22–33' })
    await expect(c.getByRole('button', { name: 'Open docs/decisions/012-refund-limits.md' })).toBeInTheDocument()
    // What isn't code stays code text.
    await expect(c.getByText('npm test').tagName).toBe('CODE')
    await userEvent.click(chip)
    await expect(chip).toHaveAttribute('data-open')
    await userEvent.click(chip)
    await expect(chip).not.toHaveAttribute('data-open')
  },
}

/** The conversation's workbench: the file beside the thread, in the page's raised tone, as wide as its edge is dragged. */
export const OnTheWorkbench: Story = {
  args: Peek.args,
  render: function Render() {
    const [width, setWidth] = useState(460)
    return (
      <div style={{ height: '100vh' }}>
        <TaskFace
          composer={<div style={{ height: 80 }} />}
          panelWidth={width}
          panel={
            <Workbench width={width} min={360} max={760} onWidth={setWidth}>
              <Stateful found={limitsFound} where={TASK} />
            </Workbench>
          }
        >
          <div style={{ padding: '0 8px' }}>
            <Markdown source={SAID} />
          </div>
        </TaskFace>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const edge = within(canvasElement).getByRole('separator', { name: 'Width of the panel' })
    await expect(edge).toHaveAttribute('aria-valuenow', '460')
    edge.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(edge).toHaveAttribute('aria-valuenow', '476')
  },
}

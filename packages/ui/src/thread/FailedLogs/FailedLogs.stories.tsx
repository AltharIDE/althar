import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { Brand } from '../../foundations/brands/brands'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Arrived } from '../Arrived/Arrived'
import { type FailedLog, FailedLogs } from './FailedLogs'

/** The end of a failed `verify` job's log, as the thread passes it: from GitHub Actions, without its times, ending where it failed. */
const VERIFY = [
  '##[group]Run bun install --frozen-lockfile',
  'bun install v1.3.0',
  'Checked 1412 installs across 1530 packages (no changes) [612.00ms]',
  '##[endgroup]',
  '##[group]Run bun run check',
  ...Array.from({ length: 24 }, (_, n) => `@althar/connectors check: ${n + 1} of 40 files type-checked`),
  '@althar/connectors check: pass: Found no warnings, lint errors, or type errors in 40 files',
  '@althar/runtime check: x typescript(TS2322): Type string is not assignable to type number.',
  '@althar/runtime check:    ,-[src/Changes.ts:2149:15]',
  '@althar/runtime check: 2149 |   const log: number = yield* readLog(host, repository, check)',
  '@althar/runtime check:      :         ^^^',
  '@althar/runtime check: Found 1 error and 0 warnings in 166 files',
  '@althar/runtime check: Exited with code 1',
  'error: script "check" exited with code 1',
  '##[error]Process completed with exit code 1.',
]

const read: FailedLog = { name: 'verify', url: 'https://github.com/AltharIDE/althar/actions/runs/1/job/2', lines: VERIFY, missing: null }
const refused: FailedLog = {
  name: 'verify',
  url: 'https://github.com/AltharIDE/althar/actions/runs/1/job/2',
  lines: null,
  missing: 'GitHub refused (403): Resource not accessible by integration. Its sign-in may not be allowed to read logs',
}
const outside: FailedLog = {
  name: 'ci/circleci: test',
  url: 'https://circleci.com/gh/AltharIDE/althar/7',
  lines: null,
  missing: 'GitHub keeps no log of it that Althar can read',
}

const meta = {
  title: 'Thread/FailedLogs',
  component: FailedLogs,
  decorators: [threadDecorator],
  args: { logs: [read] },
  render: (args) => (
    <Arrived mark={Brand.GitHub} verb={`${args.logs.length} of 8 checks failed on`} where="PR #261" at="just now">
      <p style={{ margin: 0 }}>Failed: {args.logs.map((log) => log.name).join(', ')}</p>
      <FailedLogs {...args} />
    </Arrived>
  ),
} satisfies Meta<typeof FailedLogs>
export default meta
type Story = StoryObj<typeof meta>

/** One failed check: the end of its log, with what came before one click away. */
export const EndOfItsLog: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('##[error]Process completed with exit code 1.')).toBeInTheDocument()
    await expect(c.queryByText('##[group]Run bun run check')).toBeNull()
    await expect(c.getByRole('button', { name: /earlier lines/ })).toBeInTheDocument()
  },
}

/** A log its host refused: why, and the way to the check's page instead of a name alone. */
export const Refused: Story = {
  args: { logs: [refused] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/^Couldn’t read its log: GitHub refused \(403\)/)).toBeInTheDocument()
    await expect(c.getByRole('link', { name: 'Open its page' })).toHaveAttribute('href', refused.url)
  },
}

/** Several: each by its name, a log read and one from an outside CI service, which GitHub keeps no log of. */
export const Several: Story = { args: { logs: [read, outside] } }

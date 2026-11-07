// Scrappy: each task's thread as the runtime would give it. A runtime notice whose words start with § marks where a direction draws a piece of its own.
import { items } from '../../../../apps/desktop/tests/fixtures'
import { at } from './data'
import type { AttentionRequest, ThreadItem, ThreadSnapshot } from './deps'

export interface Own {
  readonly items: ThreadItem[]
  readonly attention?: AttentionRequest[]
  readonly task?: Partial<ThreadSnapshot['task']>
}

/** Where a direction draws a piece of its own. */
export const mark = (name: string, ago: number): ThreadItem => at(items.notice({ title: name, source: 'runtime' }, null), ago)

const read = (path: string, ago: number) => at(items.tool({ title: `Read ${path}`, toolKind: 'read', locations: [{ path }] }), ago)

/** A call waiting on the person, as the runtime gives it: an MCP tool of the person's own, which can't be undone. */
const call = (id: string, title: string, reason: string, command: string, ago: number): AttentionRequest =>
  ({
    id,
    kind: 'permission',
    title,
    reason,
    command,
    held: true,
    stuck: null,
    createdAt: new Date(Date.now() - ago * 60_000).toISOString(),
  }) as AttentionRequest

/** An MCP tool call, as the agent names it: mcp__server__tool. */
const mcp = (name: string, input: string, ago: number) =>
  at(items.tool({ title: name, toolKind: 'other', command: null, output: null, label: input } as never), ago)

export const threads: Record<string, () => Own> = {
  // The person's design-review skill on a colleague's pull request: their servers read, run and post.
  'th-design': () => ({
    task: { request: 'Run my design-review skill on dana’s #612 and post what you find there. Move DEV-188 along when it’s up.' },
    items: [
      mark('§seen', 12),
      at(items.says('Loading design-review.'), 12),
      at(items.tool({ title: 'Skill design-review', toolKind: 'other' }), 12),
      mcp('mcp__github__get_pull_request', '{"pullNumber":612}', 11),
      mcp('mcp__github__get_pull_request_files', '{"pullNumber":612}', 11),
      at(items.tool({ title: 'bun --filter @althar/ui storybook', toolKind: 'execute', command: 'bun --filter @althar/ui storybook' }), 10),
      mcp('mcp__playwright__browser_take_screenshot', '{"url":"http://localhost:6126"}', 9),
      mcp('mcp__playwright__browser_take_screenshot', '{"url":"http://localhost:5173"}', 9),
      mcp('mcp__linear__get_issue', '{"id":"DEV-188"}', 8),
      mcp('mcp__github__create_pull_request_review', '{"pullNumber":612,"event":"COMMENT"}', 2),
      mcp('mcp__linear__update_issue', '{"id":"DEV-188","state":"In Review"}', 2),
      at(
        items.says(
          'The tour’s second card sits 12px lower than its story, and its title wraps at 900px. Posted that on #612 with three screenshots, and moved DEV-188 to In Review.',
        ),
        1,
      ),
      mark('§act-review', 1),
      mark('§act-linear', 1),
      mark('§mcpfail', 0),
    ],
  }),
  // A review of an outside author's pull request: read only until the person says to run it.
  'th-review': () => ({
    task: { request: 'Review ninemate’s #641.' },
    items: [
      mark('§reviewhead', 6),
      at(items.says('Reading the diff and the issue it fixes.'), 5),
      read('apps/desktop/src/main/tray.ts', 5),
      at(
        items.says(
          'The fix reads right, but nothing tests the KDE path. Running it would show whether the icon lands; that needs your word, as ninemate is outside.',
        ),
        3,
      ),
    ],
  }),
  // Ready, its lead merging on the person's word: the merge and a comment on someone else's pull request wait on them.
  'th-runs': () => ({
    task: { request: 'Runs don’t show in the pill over the composer any more. Bring them back, with where each answers.' },
    items: [
      at(items.says('The pill lists the task’s runs again, each with where it answers. #635 is open.'), 30),
      at(
        items.arrival({
          source: 'github',
          kind: 'checks',
          from: 'GitHub',
          where: 'PR #635',
          text: 'All 6 checks passed',
          passed: 6,
          failed: 0,
        } as never),
        2,
      ),
      at(
        items.says(
          'Every check on #635 passed, so it can merge. dana’s #640 fixes the same pill another way; once this merges theirs isn’t needed, and they should hear it.',
        ),
        1,
      ),
    ],
    attention: [
      call(
        'att-merge',
        'mcp__github__merge_pull_request',
        'Every check passed.',
        '{"owner":"AltharIDE","repo":"althar","pullNumber":635,"merge_method":"squash"}',
        1,
      ),
      call(
        'att-post',
        'mcp__github__add_issue_comment',
        'dana’s #640 fixes the same thing.',
        '{"owner":"AltharIDE","repo":"althar","issue_number":640,"body":"#635 brings the runs pill back over the composer too, with where each run answers. This one may not be needed once it merges."}',
        1,
      ),
    ],
  }),
  // The ADR's thread: its lead started a task, the coordinator acted in it, and a comment woke the lead.
  'th-adr': () => ({
    task: {
      request: 'Write the ADR from docs/plans/capable-by-default.md. Rewrite every ADR that limits agents beyond the irreversible list.',
    },
    items: [
      at(items.says('Reading the plan and the 14 ADRs it names.'), 47),
      read('docs/plans/capable-by-default.md', 47),
      read('docs/decisions/013-project-rules.md', 46),
      read('docs/decisions/067-what-cant-be-undone.md', 46),
      read('docs/decisions/088-what-asks-by-default.md', 45),
      read('packages/provider-adapters/src/codexHost.ts', 22),
      at(
        items.says(
          'ADR-097 is drafted. Codex’s shell still has the network off (`network_access = false` in `codexHost.ts`). That’s code, not this ADR, so I’ve started it as its own task.',
        ),
        20,
      ),
      mark('§child', 20),
      mark('§batch', 20),
      mark('§coordinator', 6),
      at(
        items.arrival({
          from: 'dana',
          where: 'PR #638',
          text: 'ADR-071’s reviewer limits should go too: a reviewer of our own change still runs nothing.',
          url: 'https://github.com/AltharIDE/althar/pull/638#issuecomment-1',
        }),
        3,
      ),
      at(
        items.says(
          'dana’s right: ADR-071 still keeps a reviewer from running the tests of the change it reviews. Lifting that is code in `Reviews.ts`, so it would be a task of its own.',
        ),
        2,
      ),
      mark('§unasked', 2),
    ],
  }),
  // A sketch: a one-line fix the person asked for, on the fast lane.
  'th-typo': () => ({
    task: { request: 'The Run menu says “Strat”. Fix it.' },
    items: [
      mark('§fast', 4),
      read('packages/ui/src/chrome/RunMenu/RunMenu.tsx', 4),
      at(
        items.tool({
          title: 'Edit packages/ui/src/chrome/RunMenu/RunMenu.tsx',
          toolKind: 'edit',
          locations: [{ path: 'packages/ui/src/chrome/RunMenu/RunMenu.tsx' }],
        }),
        3,
      ),
      at(items.says('Fixed: “Strat” is “Start”. Pull request #643 is open and its checks pass.'), 1),
    ],
  }),
  // The task the ADR's lead started.
  'th-codex-net': () => ({
    task: {
      request:
        'Codex leads reach the network in their shell. Drop `network_access = false` from the sandbox config Althar writes for Codex, and the plain-curl rule that stands in for it. ADR-097 says why.',
    },
    items: [
      mark('§origin', 3),
      at(items.says('Reading how Althar writes Codex’s config.'), 2),
      read('packages/provider-adapters/src/codexHost.ts', 2),
      at(
        items.tool({
          title: 'Edit packages/provider-adapters/src/codexHost.ts',
          toolKind: 'edit',
          locations: [{ path: 'packages/provider-adapters/src/codexHost.ts' }],
        }),
        1,
      ),
      mark('§selfpush', 1),
    ],
  }),
}

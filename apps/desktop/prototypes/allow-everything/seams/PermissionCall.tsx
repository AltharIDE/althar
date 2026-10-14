// Scrappy: the task's permission calls as the app has them, with what a path says once allow everything cleared them, or ended.
import type { AttentionRequest } from '@althar/contracts'
import { Allowed, AllowedBy, AskAnswered, AskNote, ThreadDivider } from '@althar/ui'

import { type AnswerCall, PermissionCalls as AppPermissionCalls } from '../../../src/renderer/features/task/PermissionCall'
import { clock } from '../../../src/renderer/shared/time'
import { promptOf } from '../data'
import { askAgain, type Path, type State, unrestricted, useProto } from '../store'
import { words } from '../words'

/** What the line that says it cleared says, by path, and what its Undo is called. */
const clearedWords = (path: Path, st: State, allowed: number) => {
  const others = Math.max(0, allowed - 1)
  if (st.cleared?.by === 'project') return { said: words.allowedWaiting(allowed), note: '· meridian allows everything now', undo: 'Undo' }
  switch (path) {
    case 'A':
      return { said: words.allowedWaiting(allowed), note: `· ${words.A.cleared}`, undo: 'Undo' }
    case 'B':
      return { said: words.allowedWaiting(allowed), note: `· ${words.B.cleared}`, undo: 'Undo' }
    case 'C':
      return { said: words.C.cleared, note: `· allowed this and ${others} waiting`, undo: words.C.undo }
    case 'BC':
      return { said: words.BC.cleared, note: `· allowed this and ${others} waiting`, undo: words.BC.undo }
    case 'D': {
      const until = st.taskUntil?.until ?? 'hour'
      return { said: words.allowedWaiting(allowed), note: `· allowing everything ${words.D.until[until]}`, undo: 'Undo' }
    }
    case 'T':
      return null
  }
}

/** By what it went ahead, as the receipt says it. */
const byOf = (path: Path, st: State) => {
  if (st.cleared?.by === 'project') return 'by meridian allowing everything'
  switch (path) {
    case 'A':
      return words.A.by
    case 'B':
    case 'BC':
      return words.B.by
    case 'C':
      return words.C.by
    case 'D':
      return words.D.by
    case 'T':
      return ''
  }
}

/** What went ahead once nothing waited: the four allowed, then the three sent back, spelled out by the lead this time. */
const afterwards = (st: State, by: string) => {
  const cleared = st.cleared
  if (cleared === null) return []
  const ran = cleared.allowed.flatMap((id) => {
    const prompt = promptOf(id)
    return prompt === undefined ? [] : [{ id: `ran-${id}`, cmd: prompt.command }]
  })
  const spelled = [
    'bun run test:e2e -- --grep "session timeout"',
    'SESSION_TTL=43200 bun test src/auth',
    'bunx playwright test --config e2e/staging.config.ts',
  ]
    .slice(0, cleared.sentBack.length)
    .map((cmd, index) => ({ id: `spelled-${index}`, cmd }))
  return [...ran, ...spelled].map((item) => ({ ...item, by: AllowedBy.Rule as const, rule: by }))
}

/** D: what went ahead while it was on, once it ended. */
const whileOn = (n: number, by: string) =>
  Array.from({ length: n }, (_, index) => {
    const cmds = [
      'fly deploy --app meridian-staging',
      'bun run test:e2e',
      'curl -s https://meridian-staging.fly.dev/api/session',
      'cp .env.example ~/.meridian/env.test',
    ]
    return { id: `on-${index}`, cmd: cmds[index % cmds.length] ?? '', by: AllowedBy.Rule as const, rule: by }
  })

export function PermissionCalls({
  requests,
  project,
  onAnswer,
}: {
  requests: ReadonlyArray<AttentionRequest>
  project: string
  onAnswer: AnswerCall
}) {
  const st = useProto()
  const path = st.path
  const cleared = st.cleared
  const said = cleared === null ? null : clearedWords(path, st, cleared.allowed.length)
  const by = byOf(path, st)
  const after = afterwards(st, by)
  return (
    <>
      {said !== null && cleared !== null && (
        <>
          <AskAnswered said={said.said} undo={said.undo} onUndo={askAgain}>
            <AskNote>{said.note}</AskNote>
          </AskAnswered>
          {cleared.sentBack.length > 0 && (
            <AskAnswered denied said={`Sent ${cleared.sentBack.length} back to spell out`}>
              <AskNote>· {words.sentBack(cleared.sentBack.length)}</AskNote>
            </AskAnswered>
          )}
          {unrestricted(st) && after.length > 0 && (
            <Allowed items={after} project={project} text={{ allowedCount: words.after, allowedWho: () => by }} />
          )}
        </>
      )}
      {path === 'D' && st.ended !== null && (
        <>
          <ThreadDivider icon="clock">{words.D.endedLine(clock(new Date(st.ended.at).toISOString()), st.ended.allowed)}</ThreadDivider>
          <Allowed
            items={whileOn(st.ended.allowed, words.D.by)}
            project={project}
            text={{ allowedCount: words.after, allowedWho: () => words.D.by }}
          />
        </>
      )}
      <AppPermissionCalls requests={requests} project={project} onAnswer={onAnswer} />
    </>
  )
}

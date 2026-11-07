// Scrappy, surface 3: the ask that's left, when asking is rare and matters: what can't be undone, in one line, and the action on its button.
import { type ReactNode, useState } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../../../src/primitives/Ask/Ask'
import { Button } from '../../../../src/primitives/Button/Button'
import { Model } from '../../../../src/primitives/Model/Model'
import type { ModelInfo } from '../../../../src/primitives/Model/Model'
import s from './rules.module.css'

const OPUS: ModelInfo = {
  id: 'claude-opus-5-5',
  name: 'Claude Opus 5.5',
  short: 'Opus 5.5',
  mark: Brand.Anthropic,
  runtime: 'claude-code',
  efforts: ['Low', 'Medium', 'High', 'Xhigh'],
}

/** What an agent asks to do that can't be undone, as the card says it. */
export interface Irreversible {
  readonly id: string
  /** The kind it is, as Rules lists them. */
  readonly kind: 'history' | 'publish' | 'speak' | 'secrets'
  /** The action, as its button says it: Merge #635. */
  readonly verb: string
  /** What it does, in a sentence: Merge #635 into main. */
  readonly what: string
  /** What can't be taken back, in one line. */
  readonly stays: string
  /** The words it would post, for one that speaks for the person. */
  readonly words?: string
  /** Where the call goes: the person's MCP server, by name and where it was found, or a command. */
  readonly through: { readonly server: string; readonly brand?: Brand; readonly tool: string } | { readonly command: string }
  /** What the button says once done. */
  readonly done: string
}

export const KINDS = {
  history: 'Lost work and history',
  publish: 'Publishing and merging',
  speak: 'Speaking for you',
  secrets: 'Secrets',
} as const

export const ASKS: ReadonlyArray<Irreversible> = [
  {
    id: 'att-merge',
    kind: 'publish',
    verb: 'Merge #635',
    what: 'Merge #635 into main',
    stays: 'Its commits stay in main’s history; only a revert takes them out.',
    through: { server: 'GitHub', brand: Brand.GitHub, tool: 'merge_pull_request' },
    done: 'Merged #635.',
  },
  {
    id: 'att-post',
    kind: 'speak',
    verb: 'Post as balazs',
    what: 'Comment on dana’s #640',
    stays: 'dana and everyone watching #640 see it at once.',
    words: '#635 brings the runs pill back over the composer too, with where each run answers. This one may not be needed once it merges.',
    through: { server: 'GitHub', brand: Brand.GitHub, tool: 'add_issue_comment' },
    done: 'Posted on #640.',
  },
]

const Through = ({ ask }: { ask: Irreversible }) =>
  'command' in ask.through ? (
    <code className={s.through}>{ask.through.command}</code>
  ) : (
    <span className={s.through}>
      {ask.through.brand !== undefined && <BrandMark brand={ask.through.brand} size={11} />}
      {ask.through.server}
      <span className={s.tool}>{ask.through.tool}</span>
    </span>
  )

/** One ask: the action, what can't be undone in one line under it, the words it would post, and where the call goes. */
export function IrreversibleAsk({ ask, after }: { ask: Irreversible; after?: ReactNode }) {
  const [said, setSaid] = useState<'yes' | 'no' | null>(null)
  if (said !== null)
    return (
      <AskAnswered denied={said === 'no'} said={said === 'yes' ? ask.done : 'Not now.'} onUndo={() => setSaid(null)} className={s.answered}>
        <AskNote>{said === 'yes' ? ask.what : ''}</AskNote>
      </AskAnswered>
    )
  const foot = (
    <AskFoot>
      <Button variant="quiet" onClick={() => setSaid('no')}>
        Not now
      </Button>
      <Button variant="signal" onClick={() => setSaid('yes')}>
        {ask.verb}
      </Button>
    </AskFoot>
  )
  return (
    <AskCard icon="lock" kicker="Can’t be undone" who={<Model model={OPUS} short />} what={ask.what} className={s.ask}>
      <p className={s.stays}>{ask.stays}</p>
      {ask.words !== undefined && <blockquote className={s.words}>{ask.words}</blockquote>}
      <p className={s.from}>
        <Through ask={ask} />
      </p>
      {after}
      {foot}
    </AskCard>
  )
}

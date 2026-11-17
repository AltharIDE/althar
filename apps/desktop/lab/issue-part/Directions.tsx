import type { IssueSummary } from '@althar/contracts'
import {
  Icon,
  Issue as KitIssue,
  type IssueProps,
  IssuePart as KitIssuePart,
  type IssuePartProps,
  IssueStatus,
  Menu,
  MenuRadioGroup,
  MenuRadioItem,
  Segmented,
  StatusGlyph,
  TaskParts as KitTaskParts,
  type TaskPartModel,
} from '@althar/ui'
import type { ComponentProps } from 'react'

import { issuePriority, issueStatus, productBrand, productName } from '../../src/renderer/shared/products'
import { ISSUES, PR } from './data'
import { lab, useLab } from './state'
import s from './directions.module.css'

/*
 * Each direction's issue card and what it says of the task's merge, as the
 * task's screen takes them from the kit (vite.config.ts's seam). The card is
 * the kit's own in every one; what changes is where the choice sits and how
 * it reads: today's switch under it, two words under it (A), a tag in its
 * corner (B), a sentence under it (C), or nothing under it and the choice in
 * the issue's part in the header (D). None shows on a task that ends with no
 * pull request: its merge is nothing to speak of.
 */

/** The issue as the task's screen draws it (TaskView), for the second card the lab adds. */
const cardOf = (issue: IssueSummary): IssueProps => ({
  mark: productBrand(issue.product),
  source: productName(issue.product),
  id: issue.key,
  tone: issue.product === 'linear' ? 'linear' : 'plain',
  title: issue.title,
  href: issue.url,
  status: { state: issueStatus(issue.status.category), label: issue.status.name },
  ...(issue.priority === null || issue.priority.level === 'none'
    ? {}
    : { priority: { level: issuePriority(issue.priority.level), label: issue.priority.name } }),
  ...(issue.container === null ? {} : { meta: issue.container }),
})

type Choice = 'closes' | 'part'
const choiceOf = (partOf: boolean): Choice => (partOf ? 'part' : 'closes')

/** Today's, as PR #1004 left it: a switch under the card, its note saying what each way does. */
function Today({ id, partOf, onChange }: Omit<IssuePartProps, 'text'>) {
  return (
    <KitIssuePart
      id={id}
      partOf={partOf}
      onChange={onChange}
      text={{
        label: (key) => `Keep ${key} open`,
        on: 'Merging says what landed on it, and leaves it open.',
        off: 'Merging closes it, where issues move along with their tasks.',
      }}
    />
  )
}

/** A: two words at the card's foot, both in sight, the one on lifted. */
function TwoWords({ id, partOf, onChange }: Omit<IssuePartProps, 'text'>) {
  return (
    <Segmented
      className={s.two}
      label={`What merging does to ${id}`}
      options={[
        { value: 'closes', label: 'Closes it' },
        { value: 'part', label: 'Part of it' },
      ]}
      value={choiceOf(partOf)}
      onChange={(value) => onChange(value === 'part')}
    />
  )
}

/** The menu's two ways, for B and C: each says what becomes of the issue as the task merges. */
function Ways({ id, partOf, onChange, words }: Omit<IssuePartProps, 'text'> & { words: 'tag' | 'sentence' }) {
  return (
    // C's sentence says when already: its heading names the issue, for a task of several.
    <MenuRadioGroup
      label={words === 'tag' ? 'When it merges' : id}
      value={choiceOf(partOf)}
      onChange={(value) => onChange(value === 'part')}
    >
      <MenuRadioItem value="closes" lead={<StatusGlyph status={IssueStatus.Done} />} description="The issue is done">
        {words === 'tag' ? `Closes ${id}` : 'Closes it'}
      </MenuRadioItem>
      <MenuRadioItem
        value="part"
        lead={<StatusGlyph status={IssueStatus.InProgress} />}
        description="It stays open, with a comment on what landed"
      >
        {words === 'tag' ? `Part of ${id}` : 'Leaves it open'}
      </MenuRadioItem>
    </MenuRadioGroup>
  )
}

/** B: a tag in the card's top line, the pull request's own word for it; a press changes it. */
function CornerTag(props: Omit<IssuePartProps, 'text'>) {
  return (
    <Menu
      label={`What merging does to ${props.id}`}
      placement="below"
      align="end"
      width={310}
      trigger={
        <button type="button" className={s.tag} aria-label={`${props.partOf ? 'Part of' : 'Closes'} ${props.id}, change it`}>
          <StatusGlyph status={props.partOf ? IssueStatus.InProgress : IssueStatus.Done} />
          {props.partOf ? 'Part of' : 'Closes'}
          <Icon name="chevronD" size={11} />
        </button>
      }
    >
      <Ways {...props} words="tag" />
    </Menu>
  )
}

/** C: one sentence under the card, its verb the choice. */
function Sentence(props: Omit<IssuePartProps, 'text'> & { pr: number | null }) {
  return (
    <span className={s.sentence}>
      {props.pr === null ? 'Merging' : `Merging #${props.pr}`}{' '}
      <Menu
        label={`What merging does to ${props.id}`}
        width={310}
        trigger={
          <button type="button" className={s.verb}>
            {props.partOf ? 'leaves it open' : 'closes it'}
            <Icon name="chevronD" size={11} />
          </button>
        }
      >
        <Ways {...props} words="sentence" />
      </Menu>
    </span>
  )
}

/** The issue card with its direction's choice, as the task's screen draws it, for each issue the task came from. */
export function Issue(props: IssueProps) {
  const { d, ending, two, partOf } = useLab()
  const issues = two ? [props, cardOf(ISSUES[1]!)] : [props]
  // A task that ends with no pull request has no merge to speak of.
  const shown = ending !== 'none'
  const pr = ending === 'open' ? PR : null
  return (
    <div className={s.issues}>
      {issues.map((issue) => {
        const choice = { id: issue.id, partOf: partOf[issue.id] === true, onChange: (on: boolean) => lab.setPart(issue.id, on) }
        return (
          <div key={issue.id} className={s.one} data-d={d}>
            <div className={shown && d === 'a' ? s.tray : s.card}>
              <KitIssue {...issue} />
              {shown && d === 'a' && (
                <div className={s.foot}>
                  <TwoWords {...choice} />
                </div>
              )}
              {shown && d === 'b' && (
                <span className={s.corner}>
                  <CornerTag {...choice} />
                </span>
              )}
            </div>
            {shown && d === 'today' && <Today {...choice} />}
            {shown && d === 'c' && <Sentence {...choice} pr={pr} />}
          </div>
        )
      })}
    </div>
  )
}

/** The switch the screen puts under the issue: each direction draws its own with the card, above. */
export function IssuePart(_props: IssuePartProps) {
  return null
}

/** D: nothing under the card; the issue's part, in the header's Parts, holds the choice among its facts. */
export function TaskParts(props: ComponentProps<typeof KitTaskParts>) {
  const { d, ending, two, partOf } = useLab()
  if (d !== 'd' || ending === 'none') return <KitTaskParts {...props} />
  const withChoice = (part: TaskPartModel, key: string): TaskPartModel => {
    const on = partOf[key] === true
    return {
      ...part,
      facts: [
        ...(part.facts ?? []),
        [
          'On merge',
          // The facts' list draws its divs as their contents: the choice keeps its own box.
          <span key="merge" className={s.inPart}>
            <Segmented
              label={`What merging does to ${key}`}
              options={[
                { value: 'closes', label: 'Closes it' },
                { value: 'part', label: 'Part of it' },
              ]}
              value={choiceOf(on)}
              onChange={(value) => lab.setPart(key, value === 'part')}
            />
          </span>,
        ],
      ],
    }
  }
  const second = ISSUES[1]!
  const parts = props.parts.flatMap((part) =>
    part.id !== 'issue'
      ? [part]
      : [
          withChoice(part, ISSUES[0]!.key),
          ...(two
            ? [
                withChoice(
                  {
                    id: 'issue-2',
                    icon: productBrand(second.product),
                    name: second.key,
                    detail: second.title,
                    facts: [
                      ['Title', second.title],
                      ['Status', second.status.name],
                    ],
                    actions: part.actions ?? [],
                  },
                  second.key,
                ),
              ]
            : []),
        ],
  )
  return <KitTaskParts {...props} parts={parts} />
}

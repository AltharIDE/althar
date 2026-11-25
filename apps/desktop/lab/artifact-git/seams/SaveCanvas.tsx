import type { CanvasSummary } from '@althar/contracts'
import { Button, Choices, Delta, FileChanges, LinkButton, Popover, SaveToRepo } from '@althar/ui'
import { useState } from 'react'

import { agoWords, COMMITS, PR, REPO, savedOf, versionsOf } from '../data'
import { type LabState, lab, type Person, PEOPLE, useLab, whoOf } from '../state'
import { Face } from '../wrapped'
import w from '../wrapped.module.css'

export { ruleOf, savingOf, text } from '../../../src/renderer/features/canvases/SaveCanvas'

/*
 * Save to repo, in the artifact's row, as each direction has it. A, B and C
 * keep the app's own: the button says where it is, and the kit's SaveToRepo
 * opens on it; A says the artifact's open pull request is where a save goes
 * and lists who is in it, B asks whether to add to the one someone else has
 * open or open another, C's chat has already saved. D has no save: every
 * version is in the artifact's draft as it is made, so the row says who is in
 * the draft, and opens on handing it on.
 */

const RULE = {
  pr: 'A pull request of its own, committed when you save',
  joined: 'Its open pull request, committed when you save',
  theirs: (name: string) => `${name}’s pull request, committed when you save`,
} as const

/** The commits in the artifact's open pull request, newest first, as the window's Althar has them. */
const commitsOf = (s: LabState) => {
  const ana = whoOf(s) === 'ana'
  const mine = !ana && s.saved === 'done'
  const all: Array<{
    readonly who: Person
    readonly title: string
    readonly commit: string
    readonly ago: number
    readonly add: number
    readonly del: number
  }> = []
  if (ana || mine) all.push({ who: 'maya', title: 'Update Booking page to v6', commit: COMMITS.maya, ago: ana ? 2 : 0, add: 38, del: 21 })
  all.push({ who: 'ana', title: 'Update Booking page to v4', commit: COMMITS.ana, ago: ana ? 30 : 25, add: 14, del: 6 })
  return all
}

const someone = (s: LabState, who: Person) => (who === whoOf(s) ? 'You' : PEOPLE[who].name)

export function SaveCanvas({ summary, version }: { summary: CanvasSummary; version: number }) {
  const s = useLab()
  // Opened as the moment is, where the moment is the save: once per moment, then as the person leaves it.
  return <SaveIn key={`${s.d}-${s.m}`} summary={summary} version={version} s={s} />
}

function SaveIn({ summary, version, s }: { summary: CanvasSummary; version: number; s: LabState }) {
  const ana = whoOf(s) === 'ana'
  const [open, setOpen] = useState(((s.d === 'a' || s.d === 'b') && s.m === 2) || (s.d === 'd' && s.m >= 2))
  if (s.d === 'd') return <Draft open={open} onOpenChange={setOpen} s={s} />
  const saved = savedOf(s)
  const trigger =
    saved.state === 'saving' ? (
      <Button variant="quiet" size="small" busy>
        Saving…
      </Button>
    ) : (
      <Button variant="quiet" size="small" icon="commit" title={`${saved.repository}/${saved.path}`}>
        In git
      </Button>
    )
  const intoAna = saved.pullRequest?.number === PR.ana.number
  const offers = s.d === 'b' && !ana && saved.version !== null && saved.version < version && s.saved === null
  const rule = offers ? (s.into === 'join' ? RULE.theirs('Ana') : RULE.pr) : s.d === 'a' && intoAna ? RULE.joined : RULE.pr
  const save = () => {
    lab.set({ saved: 'saving' })
    window.setTimeout(() => lab.set({ saved: 'done' }), 900)
  }
  return (
    <Popover label="Save to repo" trigger={trigger} open={open} onOpenChange={setOpen} align="end" padded={false}>
      {open && (
        <div className={w.save}>
          {offers && (
            <div className={w.offer}>
              <span className={w.offerHead}>
                <Face who="ana" /> Ana has #221 open on it
              </span>
              <Choices
                label="Where v5 goes"
                value={s.into}
                onChange={(into) => lab.set({ into })}
                options={[
                  {
                    value: 'join',
                    title: 'Add to Ana’s pull request',
                    note: 'One pull request for both of you, with her changes and yours',
                  },
                  { value: 'own', title: 'A pull request of its own', note: 'Beside hers: whichever merges second brings the other in' },
                ]}
              />
            </div>
          )}
          <SaveToRepo
            title={summary.latest.title}
            name={summary.name}
            version={version}
            repositories={[{ id: REPO, name: 'kiln' }]}
            place={{ repositoryId: REPO, repository: 'kiln', folder: 'design/', why: null }}
            first={false}
            rule={rule}
            saved={saved}
            folders={['design/', 'design/booking/', 'site/']}
            onRepository={() => undefined}
            onSave={save}
            onStop={() => undefined}
            onSettings={() => undefined}
            text={offers && s.into === 'join' ? { commit: (n) => `Add v${n} to #221` } : {}}
          />
          {s.d === 'a' && intoAna && (
            <div className={w.commits}>
              <span className={w.commitsHead}>In #221</span>
              <ol className={w.commitList}>
                {commitsOf(s).map((one) => (
                  <li key={one.commit} className={w.commit}>
                    <Face who={one.who} />
                    <span className={w.commitTitle}>{one.title}</span>
                    <span className={w.commitFacts}>
                      {someone(s, one.who)} · {agoWords(one.ago)}
                    </span>
                    <Delta add={one.add} del={one.del} />
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}

/* ---- D: the artifact's draft, everyone's ------------------------------- */

function Draft({ open, onOpenChange, s }: { open: boolean; onOpenChange: (open: boolean) => void; s: LabState }) {
  const ana = whoOf(s) === 'ana'
  const all = versionsOf(s).filter((one) => one.where === 'draft')
  // Who is in the draft, by the versions each made there: this Althar's chat is the person's own.
  const people = (['ana', 'maya'] as const)
    .map((who) => {
      const theirs = all.filter((one) => (one.who === 'chat' ? whoOf(s) : one.who) === who)
      return { who, versions: theirs.map((one) => `v${one.n}`), ago: theirs.at(-1)?.ago ?? null }
    })
    .filter((one) => one.versions.length > 0)
  const merged = s.ready === 'merged'
  const asked = ana || s.ready === 'asked'
  const trigger = (
    <Button variant="quiet" size="small">
      <span className={w.faces}>
        {people.map((one) => (
          <Face key={one.who} who={one.who} you={one.who === whoOf(s)} />
        ))}
      </span>
      {merged ? 'Merged' : asked ? 'In review · #221' : 'Draft · #221'}
    </Button>
  )
  return (
    <Popover label="The draft" trigger={trigger} open={open} onOpenChange={onOpenChange} align="end" padded={false}>
      {open && (
        <div className={w.draft}>
          <div className={w.draftHead}>
            <span className={w.draftTitle}>Booking page’s draft</span>
            <span className={w.draftWhere}>
              <a href={PR.ana.url} target="_blank" rel="noreferrer">
                #221
              </a>{' '}
              in kiln · {merged ? 'merged' : asked ? (ana ? 'Maya asked for your review' : 'waiting for Ana’s review') : 'open'}
            </span>
          </div>
          <ul className={w.people}>
            {people.map((one) => (
              <li key={one.who} className={w.person}>
                <Face who={one.who} />
                <span className={w.personName}>{someone(s, one.who)}</span>
                <span className={w.personFacts}>
                  {one.versions.join(', ')}
                  {one.ago !== null && ` · ${agoWords(one.ago)}`}
                </span>
              </li>
            ))}
          </ul>
          {ana && (
            <FileChanges
              className={w.draftFiles}
              files={[
                { path: 'design/booking/index.html', add: 52, del: 27 },
                { path: 'design/booking/styles.css', add: 18, del: 6 },
              ]}
            />
          )}
          <div className={w.draftFoot}>
            {ana ? (
              <>
                <LinkButton onClick={() => window.open(PR.ana.url, '_blank', 'noreferrer')}>Review in GitHub</LinkButton>
                <span className={w.gap} />
                <Button size="small" variant="signal" disabled={merged} onClick={() => lab.set({ ready: 'merged' })}>
                  {merged ? 'Merged' : 'Merge'}
                </Button>
              </>
            ) : asked ? (
              <>
                <LinkButton onClick={() => lab.set({ ready: null })}>Not ready</LinkButton>
                <span className={w.gap} />
                <Button size="small" variant="quiet" onClick={() => lab.set({ ready: 'merged' })} disabled={merged}>
                  {merged ? 'Merged' : 'Merge'}
                </Button>
              </>
            ) : (
              <>
                <Button size="small" variant="quiet" onClick={() => lab.set({ ready: 'merged' })}>
                  Merge
                </Button>
                <span className={w.gap} />
                <Button size="small" variant="signal" onClick={() => lab.set({ ready: 'asked' })}>
                  Ask Ana to review
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Popover>
  )
}

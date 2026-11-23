import { type ReactNode, useState } from 'react'

import {
  Checks,
  FieldArea,
  FileChanges,
  Heading,
  Icon,
  Markdown,
  NextStep,
  NextSteps,
  PullChip,
  StepTrack,
  TaskCard,
  TaskStatus,
  trackOf,
} from '../../src'
import { GITHUB } from '../../src/fixtures/outputs'
import { OPUS, SONNET } from '../../src/fixtures/models'
import {
  DESIGN_FILES,
  DESIGN_GATES,
  FRONTMATTER,
  PEOPLE,
  PROPOSED,
  RECORD,
  roleName,
  SPEC_BODY,
  SPEC_GATES_OPEN,
  SPEC_PATH,
  STAGES,
  TRACKER,
} from './data'
import { useHandoff } from './state'
import s from './handoff.module.css'

/*
 * The pane beside the conversation, as each scene draws it:
 *
 * spec     · Product's view of spec.md: its frontmatter as the page's head,
 *            then the draft, then its pull request as Spec's artefact.
 * handoff  · Design's inbox: the spec merged, and the tasks their
 *            coordinator proposed from it, held until accepted.
 * ask      · A question back from Design to Product, the stage unmoved.
 * feature  · The feature page: the timeline, each stage's artefact, pull
 *            requests and the host's gates, and who it waits on.
 * design   · Design's lens: canvases and screenshot diffs beside the
 *            feature, and design/ going into a pull request.
 */

export function Pane() {
  const { scene } = useHandoff()
  if (scene === 'spec') return <SpecPage />
  if (scene === 'handoff') return <Inbox />
  if (scene === 'ask') return <AskBack />
  if (scene === 'feature') return <FeaturePage />
  return <DesignLens />
}

/** The feature's name, its folder and its stage: the head of every page about it. */
function FeatureHead({ at, children }: { at: number; children?: ReactNode }) {
  return (
    <header className={s.head}>
      <div className={s.titleRow}>
        <Heading level={2} className={s.title}>
          Saved carts
        </Heading>
        <span className={s.mono}>{`specs/saved-carts/ · ${TRACKER}`}</span>
      </div>
      <StepTrack className={s.track} labels status={TaskStatus.Running} steps={trackOf(STAGES, at)} />
      {children}
    </header>
  )
}

/* ---------- 2 · Writing a spec ---------- */

function SpecPage() {
  const { opened, set } = useHandoff()
  return (
    <article className={s.page} aria-label="Saved carts spec">
      <header className={s.head}>
        <div className={s.titleRow}>
          <Heading level={2} className={s.title}>
            Saved carts
          </Heading>
          <span className={s.mono}>{SPEC_PATH}</span>
          <span className={s.state} data-tone={opened ? 'live' : 'quiet'}>
            {opened ? 'In review · #431' : 'Draft · not in the repository yet'}
          </span>
        </div>
        {/* spec.md's frontmatter, as facts: the stage, who owns each, and the pull requests that carry each. */}
        <div className={s.front}>
          <div className={s.frontCol}>
            <span className={s.label}>Stage</span>
            <StepTrack labels status={TaskStatus.Running} steps={trackOf(STAGES, 0)} />
          </div>
          <table className={s.owners}>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Owner</th>
                <th>Pull requests</th>
              </tr>
            </thead>
            <tbody>
              {FRONTMATTER.owners.map(([stage, role, who]) => (
                <tr key={stage}>
                  <td>{stage}</td>
                  <td>
                    {role} <span className={s.dim}>{who}</span>
                  </td>
                  <td className={s.monoCell}>{stage === 'Spec' && opened ? 'shop#431' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className={s.frontFacts}>
            <div>
              <dt>Repositories</dt>
              <dd className={s.monoCell}>{FRONTMATTER.repositories.join(', ')}</dd>
            </div>
            <div>
              <dt>Tracker</dt>
              <dd className={s.monoCell}>{TRACKER}</dd>
            </div>
          </dl>
        </div>
      </header>
      {opened ? (
        <section className={s.sheet} aria-label="Spec's pull request">
          <div className={s.sheetHead}>
            <span className={s.kicker}>Spec’s artefact</span>
            <PullChip host={GITHUB} repo="shop" number={431} add={58} del={0} />
          </div>
          <p className={s.sheetLine}>Add the Saved carts spec. When it merges on main, Saved carts moves to Design.</p>
          <Checks checks={SPEC_GATES_OPEN} />
          <p className={s.readOnly}>
            <Icon name="lock" size={11} />
            As GitHub reports them: branch protection and CODEOWNERS. Althar adds no gate of its own.
          </p>
        </section>
      ) : (
        <section className={s.sheet} aria-label="Draft">
          <div className={s.sheetHead}>
            <span className={s.kicker}>Proposed by the coordinator, from {TRACKER}</span>
          </div>
          <p className={s.sheetLine}>Nothing is written to the repository until you open it.</p>
          <NextSteps className={s.steps}>
            <NextStep onPress={() => {}}>Keep as a draft</NextStep>
            <NextStep signal onPress={() => set({ opened: true })}>
              Open as a pull request
            </NextStep>
          </NextSteps>
        </section>
      )}
      <div className={s.doc}>
        <Markdown source={SPEC_BODY} size="panel" headingLevel={3} />
      </div>
    </article>
  )
}

/* ---------- 3 · The handoff ---------- */

function Inbox() {
  const { accepted, set } = useHandoff()
  const [chosen, setChosen] = useState<readonly string[]>(PROPOSED.map((one) => one.id))
  const toggle = (id: string) => setChosen(chosen.includes(id) ? chosen.filter((one) => one !== id) : [...chosen, id])
  return (
    <article className={s.page} aria-label="Waiting on Design">
      <header className={s.head}>
        <div className={s.titleRow}>
          <Heading level={2} className={s.title}>
            Waiting on Design
          </Heading>
          <span className={s.dim}>{accepted ? 'Nothing new' : '1 handoff'}</span>
        </div>
      </header>
      <section className={s.sheet} aria-label="Saved carts: Spec to Design">
        <div className={s.sheetHead}>
          <span className={s.kicker} data-signal={!accepted || undefined}>
            Handoff · Spec → Design
          </span>
          <span className={s.dim}>8m ago</span>
        </div>
        <Heading level={3} className={s.sheetTitle}>
          Saved carts’ spec merged
        </Heading>
        <ul className={s.facts}>
          <li>
            <PullChip host={GITHUB} repo="shop" number={431} by="Réka Szabó" />
            <span className={s.dim}>merged on main · approved by the code owner of specs/</span>
          </li>
          <li>
            <Icon name="file" size={12} />
            <span className={s.mono}>{SPEC_PATH}</span>
            <span className={s.dim}>· 6 acceptance criteria · Design owner: you</span>
          </li>
        </ul>
        {accepted ? (
          <>
            <span className={s.label}>Started from it</span>
            <div className={s.cards}>
              {PROPOSED.filter((one) => chosen.includes(one.id)).map((one, i) => (
                <TaskCard
                  key={one.id}
                  task={one.task}
                  title={one.title}
                  status={TaskStatus.Running}
                  steps={['Plan', 'Prototype', 'Canvas']}
                  at={i === 0 ? 1 : 0}
                  now={i === 0 ? 'Drawing direction A on the desktop page' : 'Reading the spec'}
                  started="just now"
                  lead={i === 0 ? OPUS : SONNET}
                  meta={`From ${one.from}`}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <span className={s.label}>Your coordinator proposes, held for you</span>
            <ul className={s.proposed}>
              {PROPOSED.map((one) => (
                <li key={one.id}>
                  <label className={s.pick}>
                    <input type="checkbox" aria-label={one.title} checked={chosen.includes(one.id)} onChange={() => toggle(one.id)} />
                    <span className={s.pickText}>
                      <span className={s.pickTitle}>{one.title}</span>
                      <span className={s.dim}>
                        {one.plan} · from {one.from}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <NextSteps className={s.steps}>
              <NextStep onPress={() => {}}>Change the plans</NextStep>
              <NextStep signal onPress={() => set({ accepted: true })} disabled={chosen.length === 0}>
                {`Start ${chosen.length === PROPOSED.length ? 'all three' : chosen.length}`}
              </NextStep>
            </NextSteps>
          </>
        )}
      </section>
      <section className={s.quiet} aria-label="Earlier">
        <span className={s.label}>Earlier</span>
        <ul className={s.facts}>
          <li>
            <Icon name="comment" size={12} />
            Guest checkout · Réka commented on direction B’s canvas <span className={s.dim}>· yesterday</span>
          </li>
          <li>
            <Icon name="check" size={12} />
            Apple Pay · design/ merged, Build is Engineering’s <span className={s.dim}>· 3 days ago</span>
          </li>
        </ul>
      </section>
    </article>
  )
}

/* ---------- 4 · Asking back ---------- */

const QUESTION = 'Can a gift card pay for shipping?'
const ANSWER = 'No, gift cards pay for items only. I’m adding it to Out of scope.'

function AskBack() {
  const { role, asked, answered, set } = useHandoff()
  const [question, setQuestion] = useState(QUESTION)
  const [answer, setAnswer] = useState(ANSWER)
  const product = role === 'product'
  return (
    <article className={s.page} aria-label="Saved carts">
      <FeatureHead at={1} />
      <section className={s.sheet} aria-label="A question back">
        <div className={s.sheetHead}>
          <span className={s.kicker} data-signal={(product && !answered) || undefined}>
            {product ? 'Question from Design · to you' : asked ? 'Asked Product' : 'Ask back · to Product'}
          </span>
          <span className={s.dim}>Saved carts stays in Design</span>
        </div>
        {!product && !asked ? (
          <>
            <p className={s.sheetLine}>
              On <span className={s.mono}>spec.md</span> · acceptance 4. It goes to Spec’s owner, Réka Szabó, on #431 and {TRACKER}.
            </p>
            <FieldArea aria-label="Question" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
            <NextSteps className={s.steps}>
              <NextStep signal onPress={() => set({ asked: true })}>
                Ask Réka
              </NextStep>
            </NextSteps>
          </>
        ) : (
          <>
            <blockquote className={s.question}>
              <span className={s.who}>{product ? 'Dani Kovács' : 'You'}</span>
              {QUESTION}
              <span className={s.dim}>Direction B shows a gift card line under shipping. · acceptance 4</span>
            </blockquote>
            {answered ? (
              <blockquote className={s.question}>
                <span className={s.who}>{product ? 'You' : 'Réka Szabó'}</span>
                {ANSWER}
                <span className={s.dim}>
                  <PullChip host={GITHUB} repo="shop" number={437} add={1} del={0} /> a spec fix; the stage doesn’t move
                </span>
              </blockquote>
            ) : product ? (
              <>
                <FieldArea aria-label="Answer" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} />
                <NextSteps className={s.steps}>
                  <NextStep onPress={() => {}}>Answer only</NextStep>
                  <NextStep signal onPress={() => set({ answered: true })}>
                    Answer and fix the spec
                  </NextStep>
                </NextSteps>
              </>
            ) : (
              <p className={s.waits}>
                <Icon name="clock" size={12} />
                Waits on Réka Szabó · your tasks carry on meanwhile
              </p>
            )}
          </>
        )}
      </section>
      <Stages compact />
    </article>
  )
}

/* ---------- 5 · The feature page ---------- */

function FeaturePage() {
  return (
    <article className={s.page} aria-label="Saved carts">
      <FeatureHead at={1}>
        <p className={s.waits}>
          <Icon name="clock" size={12} />
          Waits on Noor Haddad, code owner of <span className={s.mono}>design/</span>, to review #436
        </p>
      </FeatureHead>
      <Stages />
      <p className={s.readOnly}>
        <Icon name="lock" size={11} />
        Gates as GitHub reports them: branch protection, CODEOWNERS and required reviews. Althar shows them and adds none; a stage is done
        when its artefact merges.
      </p>
    </article>
  )
}

/** Each stage: its owner, its artefact, its pull requests, and the host's gate on them. */
function Stages({ compact = false }: { compact?: boolean }) {
  const at = 1
  return (
    <ol className={s.stages}>
      {RECORD.map((record, i) => (
        <li key={record.stage} className={s.stage} data-cell={i < at ? 'done' : i === at ? 'now' : 'next'}>
          <span className={s.stageName}>{record.stage}</span>
          <span className={s.stageOwner}>
            {roleName(record.owner)}
            {record.stage === 'Spec' && <span className={s.dim}> · {PEOPLE.product.name}</span>}
            {record.stage === 'Design' && <span className={s.dim}> · {PEOPLE.design.name}</span>}
          </span>
          <span className={s.mono}>{record.artefact}</span>
          <span className={s.stagePrs}>
            {record.prs.map((pr) => (
              <span key={pr.number} className={s.pr}>
                <PullChip host={GITHUB} repo={pr.repo} number={pr.number} />
                <span className={s.dim}>{pr.state}</span>
              </span>
            ))}
          </span>
          {!compact && (record.gate !== undefined || record.note !== undefined) && (
            <span className={s.stageGate}>
              {i < at && <Icon name="check" size={11} />}
              {record.gate}
              {record.note !== undefined && <span className={s.dim}> · {record.note}</span>}
            </span>
          )}
          {!compact && i === at && (
            <div className={s.stageChecks}>
              <Checks checks={DESIGN_GATES} />
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

/* ---------- 6 · Design's lens ---------- */

function DesignLens() {
  const [chosen, setChosen] = useState('b')
  return (
    <article className={s.page} aria-label="Saved carts, design">
      <FeatureHead at={1} />
      <section aria-label="Canvases">
        <div className={s.rowHead}>
          <span className={s.label}>Canvases</span>
          <span className={s.dim}>from 512 · Réka commented on B</span>
        </div>
        <div className={s.tiles}>
          {(['a', 'b', 'c'] as const).map((d) => (
            <button key={d} type="button" className={s.tile} data-chosen={chosen === d || undefined} onClick={() => setChosen(d)}>
              <MiniCart variant={d} />
              <span className={s.tileName}>
                {{ a: 'A · Cart drawer', b: 'B · Cart page with sync line', c: 'C · Cart in the header' }[d]}
              </span>
              <span className={s.dim}>{{ a: '2 comments', b: 'Chosen · 3 comments', c: '—' }[d]}</span>
            </button>
          ))}
        </div>
      </section>
      <section aria-label="Screenshot diffs">
        <div className={s.rowHead}>
          <span className={s.label}>Screenshot diffs · main → #436</span>
          <span className={s.dim}>6 changed · accepted</span>
        </div>
        <div className={s.diffs}>
          <figure className={s.diff}>
            <MiniCart variant="old" />
            <figcaption className={s.dim}>Cart · main</figcaption>
          </figure>
          <Icon name="arrow" size={14} />
          <figure className={s.diff}>
            <MiniCart variant="b" changed />
            <figcaption className={s.dim}>Cart · #436, light</figcaption>
          </figure>
          <figure className={s.diff} data-dark="">
            <MiniCart variant="b" changed />
            <figcaption className={s.dim}>Cart · #436, dark</figcaption>
          </figure>
        </div>
      </section>
      <section className={s.sheet} aria-label="Design's artefact">
        <div className={s.sheetHead}>
          <span className={s.kicker}>Design’s artefact</span>
          <PullChip host={GITHUB} repo="shop" number={436} add={525} del={2} />
        </div>
        <p className={s.sheetLine}>
          <span className={s.mono}>specs/saved-carts/design/</span> from direction B. When it merges, Build’s owners hear it.
        </p>
        <FileChanges files={DESIGN_FILES} />
        <Checks checks={DESIGN_GATES} />
      </section>
    </article>
  )
}

/** A cart screen, drawn small, for a canvas tile or a screenshot: the old one, or a direction. */
function MiniCart({ variant, changed = false }: { variant: 'old' | 'a' | 'b' | 'c'; changed?: boolean }) {
  return (
    <div className={s.mini} data-variant={variant} aria-hidden="true">
      <div className={s.miniBar}>
        <span />
        {variant === 'c' && <span className={s.miniBadge}>3</span>}
      </div>
      <div className={s.miniBody}>
        <div className={s.miniItems}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={s.miniItem}>
              <span className={s.miniThumb} />
              <span className={s.miniLine} />
            </div>
          ))}
          {variant === 'b' && <div className={s.miniSync} data-changed={changed || undefined} />}
        </div>
        {variant !== 'c' && <div className={s.miniTotals} data-drawer={variant === 'a' || undefined} />}
      </div>
    </div>
  )
}

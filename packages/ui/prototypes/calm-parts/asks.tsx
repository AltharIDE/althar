// Scrappy: what asks for the person, as a card in the thread: the kit's Ask, its buttons and its answered line. Every direction answers here.
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../src/primitives/Ask/Ask'
import { Button } from '../../src/primitives/Button/Button'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { RateLimit } from '../../src/thread/RateLimit/RateLimit'
import { Stuck } from '../../src/thread/Stuck/Stuck'
import { type Ask, type Case, changeIn } from './cases'
import { commits, nameOf } from './need'
import { answerAsk } from './moves'
import { proto, useProto } from './state'
import { css } from './parts'
import { FLASH, OPUS, SOL, SONNET, TAKERS, TERRA } from './team'

export function AskView({ c, ask }: { c: Case; ask: Ask }) {
  const { answered } = useProto()
  const key = `${c.key}:${ask.kind}`
  const said = answered[key]
  /** A button of this ask: the card says what was chosen, and the case changes to match. */
  const answer = (choice: string) => answerAsk(c, ask, choice)
  if (said !== undefined) return <AskAnswered said={said} onUndo={() => proto.unanswer(key)} focusOnMount />
  const of = (id: string) => changeIn(c, id)
  switch (ask.kind) {
    case 'run-it':
      return (
        <AskCard icon="lock" kicker="Run it" who={`#${ask.pr} · ${ask.by}, outside the team`} what="How far should it trust this code?">
          <div className={css.choices}>
            <p>
              <b>Run safely.</b> Installs from the lockfile with install scripts off, from the registries main names. Its tests and app run
              offline, with nothing of yours copied in.
            </p>
            <p>
              <b>Trust fully.</b> Runs as your team’s code does: the recorded setup, its files, install scripts and the network.
            </p>
          </div>
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Run safely')}>
              Run safely
            </Button>
            <Button onClick={() => answer('Trust fully')}>Trust fully</Button>
            <LinkButton onClick={() => answer('Not now')}>Not now</LinkButton>
          </AskFoot>
          <AskNote>Settings can answer this for code from outside the team.</AskNote>
        </AskCard>
      )
    case 'switch': {
      const change = of(ask.change)
      return (
        <AskCard
          icon="folder"
          kicker="Local"
          who="Before it moves"
          what={`Your checkout is on ${ask.own}, a branch of yours. It goes back to it when you settle this task.`}
        >
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Switch')}>
              Switch to <code>{change?.branch}</code>
            </Button>
            <Button onClick={() => answer('Stay')}>Stay in the worktree</Button>
          </AskFoot>
        </AskCard>
      )
    }
    case 'settle-unshipped': {
      const change = of(ask.change)
      return (
        <AskCard
          icon="after"
          kicker="Before it settles"
          what={`${commits(change?.waiting ?? 0)} on ${change?.branch ?? ''} aren’t shipped.`}
        >
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Ship, then settle')}>
              Ship, then settle
            </Button>
            <Button onClick={() => answer('Leave them')}>Leave them on the branch</Button>
          </AskFoot>
        </AskCard>
      )
    }
    case 'merge-unshipped': {
      const change = of(ask.change)
      const name = change === undefined ? '' : nameOf(change)
      return (
        <AskCard icon="pr" kicker={`Merge ${name}`} what={`${commits(change?.waiting ?? 0)} aren’t shipped yet.`}>
          <div className={css.choices}>
            <p>
              <b>Review and merge.</b> One review of the {commits(change?.waiting ?? 0)}, then they go up and {name} merges.
            </p>
            <p>
              <b>Merge now.</b> They go up and merge at once, and GPT-6.1 Sol reviews them after, here.
            </p>
          </div>
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Review and merge')}>
              Review and merge
            </Button>
            <Button onClick={() => answer('Merge now')}>Merge now</Button>
          </AskFoot>
        </AskCard>
      )
    }
    case 'remove-draft':
      return (
        <AskCard
          icon="comment"
          kicker={`Remove the review of #${ask.pr}`}
          what={`Its ${ask.findings} comments aren’t posted. Removed, they stay in this thread, and nothing reaches #${ask.pr}.`}
        >
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Post it first')}>
              Post it first
            </Button>
            <Button variant="danger" onClick={() => answer('Remove without posting')}>
              Remove without posting
            </Button>
            <LinkButton onClick={() => answer('Keep it')}>Keep it</LinkButton>
          </AskFoot>
        </AskCard>
      )
    case 'after-merge':
      return (
        <AskCard icon="answer" kicker={`After #${ask.pr} merged`} who="GPT-6.1 Sol" what={`Found ${ask.findings.length} in what merged.`}>
          <ol className={css.findings}>
            {ask.findings.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ol>
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Fix it')}>
              Fix it
            </Button>
            <Button onClick={() => answer('Leave it')}>Leave it</Button>
          </AskFoot>
        </AskCard>
      )
    case 'close-old':
      return (
        <AskCard icon="pr" kicker={`#${ask.now} is up`} what={`#${ask.old}, toward main, is still open with what it had.`}>
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Close it')}>
              Close #{ask.old}
            </Button>
            <Button onClick={() => answer('Keep it open')}>Keep it open</Button>
          </AskFoot>
        </AskCard>
      )
    // Out of usage: the kit's own card, with the models free now to move the work to, each with how it is reached.
    case 'usage':
      return (
        <RateLimit
          runtime={ask.agent.startsWith('Claude') ? 'Claude Code' : ask.agent}
          resets={ask.until}
          affects={[{ id: 'lead', label: 'the lead', model: OPUS }]}
          options={[
            { model: SOL, note: 'Codex · 38% of this week used' },
            { model: TERRA, note: 'Codex · 38% of this week used' },
            { model: FLASH, note: 'OpenCode Go · your plan' },
            { model: SONNET, note: 'same limit, resets 14:00', busy: true },
          ]}
          onSwap={(id) => answer(`swap:${[SOL, TERRA, FLASH, SONNET].find((one) => one.id === id)?.name ?? id}`)}
          onWait={() => answer('Wait')}
        />
      )
    // A stuck step: the kit's own card, with the models that can take the review over in its menu.
    case 'stuck':
      return (
        <Stuck
          step={ask.what}
          what={`${ask.why} The 2 commits are still held; nothing went up.`}
          tried={[{ id: 'again', what: 'Asked GPT-6.1 Sol again', result: 'No answer after 2 minutes' }]}
          handOn={{ models: TAKERS, onHandOn: (model) => answer(`retry:${model.name}`) }}
          onAgain={() => answer('Try again')}
          onAbandon={() => answer('Ship without it')}
          primary="again"
          text={{ retry: 'Review with another model', retryLabel: 'Review with', abandon: 'Ship without the review' }}
        />
      )
    case 'refused': {
      const change = of(ask.change)
      return (
        <AskCard icon="lock" kicker="Not shipped" who={change === undefined ? '' : nameOf(change)} what={ask.why}>
          <AskNote>Reviewed and ready: the {commits(change?.waiting ?? 0)} are still here, held.</AskNote>
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Set up signing')}>
              Set up signing
            </Button>
            <Button onClick={() => answer('Try again')}>Try again</Button>
          </AskFoot>
        </AskCard>
      )
    }
    case 'attach': {
      const change = of(ask.change)
      return (
        <AskCard
          icon="pr"
          kicker="Found, not taken"
          quiet
          what={`#${ask.pr} is from ${change?.branch ?? ''}, but into ${ask.base}, not main. It isn’t taken as ${change === undefined ? '' : nameOf(change)}’s.`}
        >
          <AskFoot>
            <Button onClick={() => answer('Attach it')}>Attach it as its own change</Button>
            <LinkButton onClick={() => answer('Leave it')}>Leave it</LinkButton>
          </AskFoot>
        </AskCard>
      )
    }
    case 'preset-offer':
      return (
        <AskCard
          icon="agents"
          kicker="The coordinator"
          who="A preset"
          quiet
          what={`You’ve started three tasks with these parts. Keep them as “${ask.name}”?`}
        >
          <AskNote>{ask.holds}.</AskNote>
          <AskFoot>
            <Button onClick={() => answer('Keep it')}>Keep it</Button>
            <LinkButton onClick={() => answer('Not now')}>Not now</LinkButton>
          </AskFoot>
        </AskCard>
      )
    case 'ship-stack': {
      const change = of(ask.change)
      const below = change?.heldBy === undefined ? undefined : of(change.heldBy)
      return (
        <AskCard
          icon="after"
          kicker="Held"
          what={`${change === undefined ? '' : nameOf(change)} carries the ${commits(below?.waiting ?? 0)} waiting on ${below === undefined ? '' : nameOf(below)} below it, so it goes up only with them.`}
        >
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Ship')}>
              Ship {change === undefined ? '' : nameOf(change)}, and the {commits(below?.waiting ?? 0)} on{' '}
              {below === undefined ? '' : nameOf(below)} below it
            </Button>
          </AskFoot>
        </AskCard>
      )
    }
  }
}

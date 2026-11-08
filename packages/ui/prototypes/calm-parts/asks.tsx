// Scrappy: what asks for the person, as a card in the thread: the kit's Ask, its buttons and its answered line. Every direction answers here.
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../src/primitives/Ask/Ask'
import { Button } from '../../src/primitives/Button/Button'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { type Ask, type Case, changeIn } from './cases'
import { commits, nameOf } from './need'
import { proto, useProto } from './state'
import { css } from './parts'

/** The case an answer moves the page to, where there is one: so an answer shows what it leads to. */
const NEXT: Partial<Record<string, string>> = {
  'run-it:Run safely': 'runs-safely',
  'switch:Stay in the worktree': '',
}

export function AskView({ c, ask }: { c: Case; ask: Ask }) {
  const { answered } = useProto()
  const key = `${c.key}:${ask.kind}`
  const said = answered[key]
  const answer = (words: string) => {
    proto.answer(key, words)
    const next = NEXT[`${ask.kind}:${words}`]
    if (next !== undefined && next !== '') window.setTimeout(() => proto.go(next), 700)
  }
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
            <Button variant="signal" onClick={() => answer(`Switched to ${change?.branch ?? ''}`)}>
              Switch to <code>{change?.branch}</code>
            </Button>
            <Button onClick={() => answer('Stay in the worktree')}>Stay in the worktree</Button>
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
            <Button onClick={() => answer('Settled. The commits stay on the branch.')}>Leave them on the branch</Button>
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
            <Button variant="signal" onClick={() => answer(`Posted on #${ask.pr}, then removed`)}>
              Post it first
            </Button>
            <Button variant="danger" onClick={() => answer('Removed. The draft stays in the thread.')}>
              Remove without posting
            </Button>
            <LinkButton onClick={() => answer('Kept')}>Keep it</LinkButton>
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
            <Button variant="signal" onClick={() => answer(`Fix it: a new change, after #${ask.pr}`)}>
              Fix it
            </Button>
            <Button onClick={() => answer('Left. The findings stay here.')}>Leave it</Button>
          </AskFoot>
        </AskCard>
      )
    case 'close-old':
      return (
        <AskCard icon="pr" kicker={`#${ask.now} is up`} what={`#${ask.old}, toward main, is still open with what it had.`}>
          <AskFoot>
            <Button variant="signal" onClick={() => answer(`Closed #${ask.old}`)}>
              Close #{ask.old}
            </Button>
            <Button onClick={() => answer(`Kept #${ask.old} open`)}>Keep it open</Button>
          </AskFoot>
        </AskCard>
      )
    case 'usage':
      return (
        <AskCard
          icon="clock"
          kicker="Out of usage"
          who={ask.agent}
          what={`Claude’s plan is used up until ${ask.until}. Your message waits, and goes as soon as it resets.`}
        >
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Moved to DeepSeek V4.1 Flash')}>
              Use DeepSeek V4.1 Flash
            </Button>
            <Button onClick={() => answer(`Waits until ${ask.until}`)}>Wait until {ask.until}</Button>
          </AskFoot>
        </AskCard>
      )
    case 'stuck':
      return (
        <AskCard icon="hold" kicker="Stuck" who={ask.what} what={ask.why}>
          <AskNote>The 2 commits are still held. Nothing went up.</AskNote>
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Trying the review again')}>
              Try again
            </Button>
            <Button onClick={() => answer('Moved the review to DeepSeek V4.1 Flash')}>Review with DeepSeek V4.1 Flash</Button>
            <LinkButton onClick={() => answer('Shipped without a review')}>Ship without it</LinkButton>
          </AskFoot>
        </AskCard>
      )
    case 'refused': {
      const change = of(ask.change)
      return (
        <AskCard icon="lock" kicker="Not shipped" who={change === undefined ? '' : nameOf(change)} what={ask.why}>
          <AskNote>Reviewed and ready: the {commits(change?.waiting ?? 0)} are still here, held.</AskNote>
          <AskFoot>
            <Button variant="signal" onClick={() => answer('Signing set up. Shipped.')}>
              Set up signing
            </Button>
            <Button onClick={() => answer('Shipping again')}>Try again</Button>
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
            <Button onClick={() => answer(`Attached #${ask.pr} as a change of its own`)}>Attach it as its own change</Button>
            <LinkButton onClick={() => answer('Left alone')}>Leave it</LinkButton>
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
            <Button onClick={() => answer(`Kept as “${ask.name}”`)}>Keep it</Button>
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
            <Button
              variant="signal"
              onClick={() =>
                answer(`Shipping ${below === undefined ? '' : nameOf(below)}, then ${change === undefined ? '' : nameOf(change)}`)
              }
            >
              Ship {change === undefined ? '' : nameOf(change)}, and the {commits(below?.waiting ?? 0)} on{' '}
              {below === undefined ? '' : nameOf(below)} below it
            </Button>
          </AskFoot>
        </AskCard>
      )
    }
  }
}

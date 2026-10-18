import type { Fold } from './parts'

/*
 * The page written out, When an account runs out, in the words every
 * direction shares. Each lays them out its own way; Questions asks them as
 * questions. True to Althar 0.4.0 and to ADR-012 and ADR-013.
 */

export const KICKER = 'How it behaves'

export const TITLE = (
  <>
    When an account <b>runs out.</b>
  </>
)

export const LEAD =
  'Every plan you pay for has a usage limit. Here’s what Althar does when one is reached, and the one choice that’s yours.'

export const GIST = (
  <>
    By default the work moves to the next agent with room, and <b>carries on from where it stood.</b> You don’t have to do anything.
  </>
)

export const SECTIONS = [
  { id: 'happens', no: '01', title: 'What happens' },
  { id: 'goes', no: '02', title: 'What goes with the work' },
  { id: 'plans', no: '03', title: 'Your other plans' },
  { id: 'choose', no: '04', title: 'Choosing what happens' },
  { id: 'behind', no: '05', title: 'Behind the scenes' },
] as const

export const HAPPENS = (
  <>
    <p>
      Say Claude Code is working on a task on your Max plan, and halfway through, the plan reaches its limit. Althar pauses the work, looks
      down your agents for the next one that’s signed in and free, and hands it over. That agent reads the task’s record first: what you
      asked, what’s been done so far, and what review found. Then it carries on.
    </p>
    <p>The task’s thread says so in one quiet line. Nothing pings you, because there’s nothing for you to decide.</p>
  </>
)

export const HAPPENS_CAPTION =
  'Task 431 on one morning: Claude Code’s plan runs out at 11:31, and Codex carries the task on until it’s ready for you.'

export const OWN = (
  <p>
    Another agent takes the work over only on an account a plan pays for. It won’t start spending an API key you pay for by the token,
    unless you move the work there yourself.
  </p>
)

export const GOES = (
  <p>
    Everything Althar keeps for the task goes with it. The one thing that stays behind is the old agent’s own memory, which is why the new
    one reads first.
  </p>
)

export const PLANS = (
  <>
    <p>
      You can sign in to each agent as many times as you have plans: work and personal, Max and Pro. Althar doesn’t move work between your
      own plans of one agent unless a project says so. Turn on rotation in a project’s rules, and when one plan runs out the next takes
      over, in the order you set.
    </p>
  </>
)

export const HEADS = (
  <p>
    A second Claude plan you’ve added isn’t used on its own. Rotating between your own plans is off until you turn it on for a project,
    because some providers’ terms restrict it.
  </p>
)

export const CHOOSE = (
  <p>
    Each project decides for itself, in its rules under <b>Limits</b>. If you’ve never opened them, the work moves on. Try the three here:
    pick one, then use the plan up.
  </p>
)

export const CALL = (
  <p>
    Prefer to decide each time? Choose <b>Ask me</b>. The task waits in Needs you, in violet, with the models that are free right now and
    when the agent is back.
  </p>
)

export const NOTE = <p>Some agents don’t say when they reset. Then, instead of waiting, you can try the same agent again.</p>

export const FOLDS: readonly Fold[] = [
  {
    q: 'How does Althar pick the next account?',
    a: (
      <p>
        A new session takes the first account, in your order from Settings, that the project allows, is signed in and isn’t out of usage. A
        conversation stays on the account it runs on.
      </p>
    ),
  },
  {
    q: 'Why don’t my own plans take turns by default?',
    a: (
      <p>
        Failing over from one personal plan to the next is something providers’ consumer terms tend to restrict, so Althar leaves it to you,
        made per project.
      </p>
    ),
  },
  {
    q: 'Can a project keep to some of my accounts?',
    a: (
      <p>
        Yes. A project’s rules can limit each agent to some of its accounts, so a client’s repository only ever runs on the client’s plan.
      </p>
    ),
  },
  {
    q: 'Where was this decided?',
    a: (
      <p>
        In <a href="https://github.com/AltharIDE/althar/blob/main/docs/decisions/012-several-accounts-per-agent.md">ADR-012</a>, several
        accounts per agent, and <a href="https://github.com/AltharIDE/althar/blob/main/docs/decisions/013-project-rules.md">ADR-013</a>, the
        project’s rules.
      </p>
    ),
  },
]

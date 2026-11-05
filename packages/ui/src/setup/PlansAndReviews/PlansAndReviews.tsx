import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Select } from '../../primitives/Select/Select'
import { SettingList, SettingRow } from '../Preferences/Preferences'

/*
 * How plans start and how long review goes on, as rows of the Settings tab:
 * how long a plan waits before it starts on its own, how many rounds of
 * review a task has, and what it does when they run out. Each is a choice
 * from a few, kept at once. A row that
 * isn't at today's value says so, and goes back to it in one click. Nothing
 * here says what is running now: settings are calm.
 */

/** Seconds a proposed plan waits before it starts on its own; 0 starts it at once. */
export type Countdown = 0 | 10 | 25 | 60
/** Review rounds before the task goes on or is left to the person. */
export type ReviewRounds = 1 | 2 | 3 | 5

/**
 * What a task does when its rounds run out with fixes no review has seen: goes on once every finding is settled, or asks the
 * person.
 */
export type RoundsOut = 'settled' | 'ask'

export interface PlansAndReviewsValue {
  countdown: Countdown
  rounds: ReviewRounds
  roundsOut: RoundsOut
}

/** Today's values, which a row goes back to. */
export const plansAndReviewsDefault: PlansAndReviewsValue = { countdown: 25, rounds: 3, roundsOut: 'settled' }

export interface PlansAndReviewsText {
  countdown: { title: string; note: (seconds: Countdown) => string; label: (seconds: Countdown) => string }
  rounds: { title: string; note: string; label: (rounds: ReviewRounds) => string }
  roundsOut: { title: string; note: (choice: RoundsOut) => string; label: (choice: RoundsOut) => string }
  /** Offers the default, named. */
  reset: (label: string) => string
}

export const plansAndReviewsText: PlansAndReviewsText = {
  countdown: {
    title: 'Start a plan after',
    note: (seconds) => (seconds === 0 ? 'The plan starts as soon as it’s proposed.' : 'You can start or hold it before then.'),
    label: (seconds) => (seconds === 0 ? 'Right away' : seconds === 60 ? '1 minute' : `${seconds} seconds`),
  },
  rounds: {
    title: 'Rounds of review',
    note: 'The last round’s fixes are not read again.',
    label: (rounds) => (rounds === 1 ? '1 round' : `${rounds} rounds`),
  },
  roundsOut: {
    title: 'When rounds run out',
    note: (choice) => (choice === 'settled' ? 'A finding left open stops the task.' : 'The task waits for you.'),
    label: (choice) => (choice === 'settled' ? 'Carry on when every finding is settled' : 'Ask me'),
  },
  reset: (label) => `Default: ${label}`,
}

const COUNTDOWNS: readonly Countdown[] = [0, 10, 25, 60]
const ROUNDS: readonly ReviewRounds[] = [1, 2, 3, 5]
const ROUNDS_OUT: readonly RoundsOut[] = ['settled', 'ask']

export interface PlansAndReviewsProps {
  value: PlansAndReviewsValue
  /** What changed; the rest stays. */
  onChange: (change: Partial<PlansAndReviewsValue>) => void
  text?: Partial<PlansAndReviewsText>
}

/** The choices for how plans start, how long review goes on and what happens when it runs out. */
export function PlansAndReviews({ value, onChange, text }: PlansAndReviewsProps) {
  const t = { ...plansAndReviewsText, ...text }
  /** A row: its choice at the end, and, away from today's value, the way back to it in its line. */
  const row = <V extends number | string>(
    key: keyof PlansAndReviewsValue,
    title: string,
    note: string,
    choices: readonly V[],
    label: (choice: V) => string,
    width = 150,
  ) => {
    const chosen = value[key] as V
    const today = plansAndReviewsDefault[key] as V
    return (
      <SettingRow
        title={title}
        note={
          <>
            {note}
            {chosen !== today && (
              <>
                {' '}
                <LinkButton onClick={() => onChange({ [key]: today })}>{t.reset(label(today))}</LinkButton>
              </>
            )}
          </>
        }
      >
        {() => (
          <Select<string>
            label={title}
            value={String(chosen)}
            onChange={(next) => onChange({ [key]: typeof today === 'number' ? Number(next) : next })}
            options={choices.map((choice) => ({ value: String(choice), label: label(choice) }))}
            width={width}
          />
        )}
      </SettingRow>
    )
  }
  return (
    <SettingList>
      {row('countdown', t.countdown.title, t.countdown.note(value.countdown), COUNTDOWNS, t.countdown.label)}
      {row('rounds', t.rounds.title, t.rounds.note, ROUNDS, t.rounds.label)}
      {row('roundsOut', t.roundsOut.title, t.roundsOut.note(value.roundsOut), ROUNDS_OUT, t.roundsOut.label, 280)}
    </SettingList>
  )
}

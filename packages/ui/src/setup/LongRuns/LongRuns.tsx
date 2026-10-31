import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Select } from '../../primitives/Select/Select'
import { SettingList, SettingRow } from '../Preferences/Preferences'

/*
 * How long work goes on alone, as four rows of the Settings tab: how long a
 * plan waits before it starts on its own, how many rounds of review a task
 * has, when a turn that has gone quiet is restarted, and when agents check in
 * after a long run. Each is a choice from a few, kept at once. A row that
 * isn't at today's value says so, and goes back to it in one click. Nothing
 * here says what is running now: settings are calm.
 */

/** Seconds a proposed plan waits before it starts on its own; 0 starts it at once. */
export type Countdown = 0 | 10 | 25 | 60
/** Review rounds before a task is left to the person with findings open. */
export type ReviewRounds = 1 | 2 | 3 | 5
/** Minutes a turn may show no sign of life before it is restarted. */
export type QuietMinutes = 5 | 10 | 20
/** Hours of work since the person last wrote before agents check in; 0 never. */
export type CheckIn = 2 | 6 | 12 | 0

export interface LongRunsValue {
  countdown: Countdown
  rounds: ReviewRounds
  quiet: QuietMinutes
  checkIn: CheckIn
}

/** Today's values, which a row goes back to. */
export const longRunsDefault: LongRunsValue = { countdown: 25, rounds: 3, quiet: 10, checkIn: 6 }

export interface LongRunsText {
  countdown: { title: string; note: string; label: (seconds: Countdown) => string }
  rounds: { title: string; note: string; label: (rounds: ReviewRounds) => string }
  quiet: { title: string; note: string; label: (minutes: QuietMinutes) => string }
  checkIn: { title: string; note: (hours: CheckIn) => string; label: (hours: CheckIn) => string }
  /** Goes back to today's value, named. */
  reset: (label: string) => string
}

export const longRunsText: LongRunsText = {
  countdown: {
    title: 'Start a plan after',
    note: 'You can start or hold it before then.',
    label: (seconds) => (seconds === 0 ? 'Right away' : seconds === 60 ? '1 minute' : `${seconds} seconds`),
  },
  rounds: {
    title: 'Rounds of review',
    note: 'Then the task is yours to decide.',
    label: (rounds) => (rounds === 1 ? '1 round' : `${rounds} rounds`),
  },
  quiet: {
    title: 'Restart a quiet turn after',
    note: 'Twice as long while a command runs.',
    label: (minutes) => `${minutes} minutes`,
  },
  checkIn: {
    title: 'Check in after',
    note: (hours) => (hours === 0 ? 'Agents go on until you stop them.' : 'Of work since you last wrote, or 40 turns.'),
    label: (hours) => (hours === 0 ? 'Never' : `${hours} hours`),
  },
  reset: (label) => `Use ${label}`,
}

const COUNTDOWNS: readonly Countdown[] = [0, 10, 25, 60]
const ROUNDS: readonly ReviewRounds[] = [1, 2, 3, 5]
const QUIETS: readonly QuietMinutes[] = [5, 10, 20]
const CHECK_INS: readonly CheckIn[] = [2, 6, 12, 0]

export interface LongRunsProps {
  value: LongRunsValue
  /** What changed; the rest stays. */
  onChange: (change: Partial<LongRunsValue>) => void
  text?: Partial<LongRunsText>
}

/** The four choices for how long work goes on alone. */
export function LongRuns({ value, onChange, text }: LongRunsProps) {
  const t = { ...longRunsText, ...text }
  /** A row: its choice at the end, and, away from today's value, the way back to it in its line. */
  const row = <V extends number>(
    key: keyof LongRunsValue,
    title: string,
    note: string,
    choices: readonly V[],
    label: (choice: V) => string,
  ) => {
    const chosen = value[key] as number as V
    const today = longRunsDefault[key] as number as V
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
            onChange={(next) => onChange({ [key]: Number(next) })}
            options={choices.map((choice) => ({ value: String(choice), label: label(choice) }))}
            width={150}
          />
        )}
      </SettingRow>
    )
  }
  return (
    <SettingList>
      {row('countdown', t.countdown.title, t.countdown.note, COUNTDOWNS, t.countdown.label)}
      {row('rounds', t.rounds.title, t.rounds.note, ROUNDS, t.rounds.label)}
      {row('quiet', t.quiet.title, t.quiet.note, QUIETS, t.quiet.label)}
      {row('checkIn', t.checkIn.title, t.checkIn.note(value.checkIn), CHECK_INS, t.checkIn.label)}
    </SettingList>
  )
}

import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { SettingChanged } from '../settings'
import { call, ClientAuthority, command } from './rpc'
import { AccountStrategy, AfterMergeRule, FolderWait, PresetParts, ShipRoute } from './shared'

/** What the person may set on a built-in preset as their own: its lead and reviewer, their efforts, and its brief. */
export const PresetTuning = Schema.Struct({
  lead: Schema.optional(Schema.NullOr(Schema.String)),
  reviewer: Schema.optional(Schema.NullOr(Schema.String)),
  effort: Schema.optional(Schema.NullOr(Schema.String)),
  reviewerEffort: Schema.optional(Schema.NullOr(Schema.String)),
  brief: Schema.optional(Schema.String),
})
export type PresetTuning = typeof PresetTuning.Type

/** A named set of starting parts: built in, or the person's own, kept to a project where `projectId` says. */
export const Preset = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  parts: PresetParts,
  builtin: Schema.Boolean,
  projectId: Schema.NullOr(Schema.String),
  /** What it holds, in words. */
  about: Schema.String,
  /** The project it is kept to, by name; absent for every project. */
  keptTo: Schema.optional(Schema.String),
  /** The project of the task it was saved from, by name: the one it can be kept to. Absent for one it can't. */
  from: Schema.optional(Schema.String),
  /** A built-in one the person tuned: its lead, reviewer, efforts or brief are theirs, until they reset it. */
  tuned: Schema.optional(Schema.Boolean),
  /** On a tuned one, the built-in as it is, naming no model: what Reset takes it back to, shown at once. */
  asBuilt: Schema.optional(Schema.Struct({ parts: PresetParts, about: Schema.String })),
})
export type Preset = typeof Preset.Type

/** The most agents at work at once the person can set, as Althar is built for (docs/architecture/07). */
export const MOST_AT_ONCE = 16

/** How many agents may be at work at once on this machine: one to MOST_AT_ONCE. */
export const AtOnceCount = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MOST_AT_ONCE }))

/**
 * How many tasks' agents may be at work at once on this machine (ADR-032):
 * the person's number, else the default Althar worked out at this launch
 * from the machine's cores and memory, which it says so Settings can say why.
 */
export const AgentsAtOnce = Schema.Struct({
  /** As many as are at work at once now: the person's number, else the default. */
  count: AtOnceCount,
  /** The person's own number; null where they left the default. */
  own: Schema.NullOr(AtOnceCount),
  /** The default, and what it came from: the machine's cores, and its memory in whole GB. */
  machine: Schema.Struct({ count: AtOnceCount, cores: Schema.Int, memory: Schema.Int }),
})
export type AgentsAtOnce = typeof AgentsAtOnce.Type

/**
 * How plans start and how long review goes on. Each is a choice from a few, today's value kept until the person changes it;
 * it applies from the next plan proposed or round of review.
 */
export const COUNTDOWNS = [0, 10, 25, 60] as const
export const REVIEW_ROUNDS = [1, 2, 3, 5] as const
/**
 * What a task does when its rounds of review run out with changes no review has seen: goes on to its ending once the lead has
 * settled every finding, or asks the person (the stuck card).
 */
export const ROUNDS_OUT = ['settled', 'ask'] as const

export const PlansAndReviews = Schema.Struct({
  /** Seconds a proposed plan waits before it starts on its own; 0 starts it at once. */
  countdown: Schema.Literals(COUNTDOWNS),
  /** Review rounds before the task goes on or is left to the person, as `roundsOut` says. */
  rounds: Schema.Literals(REVIEW_ROUNDS),
  /** What a task does when its rounds run out and the lead's last fixes were never reviewed. */
  roundsOut: Schema.Literals(ROUNDS_OUT),
})
export type PlansAndReviews = typeof PlansAndReviews.Type

/** What of them is changed: the rest stays. */
export type PlansAndReviewsChange = { readonly [Key in keyof PlansAndReviews]?: PlansAndReviews[Key] | undefined }

/** Today's values, which a setting keeps until the person changes it. */
export const PLANS_AND_REVIEWS: PlansAndReviews = { countdown: 25, rounds: 3, roundsOut: 'settled' }

/**
 * What a project's rules start from when it is made. A project made earlier keeps its own rules, and each is changed in a
 * project afterwards on its rules screen.
 */
export const NewProjectDefaults = Schema.Struct({
  /** What happens to the work when an agent's account runs out. */
  usageLimit: Schema.Literals(['move', 'wait', 'ask']),
  /** Whether work goes on with an agent's next account before the limit applies. */
  rotateAccounts: Schema.Boolean,
  accountStrategy: AccountStrategy,
  /** How a task ends when its plan doesn't say. */
  end: Schema.Literals(['draft', 'ready', 'none']),
  /** Whether a lead's commits go up to its pull request on their own. */
  pushCommits: Schema.Boolean,
  /** Whether a task's screenshots are posted to its pull request on their own. */
  postScreenshots: Schema.Boolean,
  /** Whether a lead resolves a conflict with the default branch on its own. */
  resolveConflicts: Schema.Boolean,
  /** Whether a task's issue moves along with it. */
  moveIssues: Schema.Boolean,
  /** What a small change's review after it merges brings back. */
  afterMergeReview: AfterMergeRule,
})
export type NewProjectDefaults = typeof NewProjectDefaults.Type

/** What of them is changed: the rest stays. */
export type NewProjectDefaultsChange = { readonly [Key in keyof NewProjectDefaults]?: NewProjectDefaults[Key] | undefined }

/** What a project's rules are made with when the person has chosen nothing. */
export const NEW_PROJECT_DEFAULTS: NewProjectDefaults = {
  usageLimit: 'move',
  rotateAccounts: true,
  accountStrategy: 'most_room',
  end: 'draft',
  pushCommits: true,
  postScreenshots: false,
  resolveConflicts: true,
  moveIssues: true,
  afterMergeReview: 'major',
}

/** How the review seal on a pull request looks: a round engraved stamp, a pressed wax seal, or a printer's colophon. */
export const SealStyle = Schema.Literals(['ring', 'wax', 'colophon'])
export type SealStyle = typeof SealStyle.Type

/** The person's settings for the app as a whole. */
export const AppSettings = Schema.Struct({
  plansAndReviews: PlansAndReviews,
  newProjects: NewProjectDefaults,
  /** Althar as co-author of what it sends to a code host, on unless turned off; `line` is the trailer each commit gets. */
  coAuthor: Schema.Struct({ on: Schema.Boolean, line: Schema.String }),
  /** A pull request Althar opens says how its change was reviewed, on unless turned off: a seal in its corner, in `style`, and what the review changed and kept. */
  reviewSeal: Schema.Struct({ on: Schema.Boolean, style: SealStyle }),
  agentsAtOnce: AgentsAtOnce,
  /** A review of the team's pull request posts itself once drafted, without asking; off unless the person turns it on. Outside ones always wait. */
  postTeamReviews: Schema.Boolean,
  /** What "Run it" on code from outside the team does without asking: `ask` each time, its default, run `safe`ly, or trust it `full`y. */
  runOutside: Schema.optional(Schema.Literals(['ask', 'safe', 'full'])),
  /** What sending does while an agent is mid-turn: `queue` it for the turn's end, its default, or `steer` it to the agent at once. */
  sendMidTurn: Schema.optional(Schema.Literals(['queue', 'steer'])),
  /** The route the person's Ships take unless they choose another for one: absent until they make one their default. */
  shipRoute: Schema.optional(ShipRoute),
  /** Every automation is paused: none starts until the person resumes them. Runs under way finish. */
  automationsPaused: Schema.Boolean,
  /** When finished tasks' folders go: `smart` unless the person chose otherwise. */
  folderWait: FolderWait,
})
export type AppSettings = typeof AppSettings.Type

/**
 * The person's settings for every project: the settings read, each switch, presets and applying one.
 * The setting changes an agent asks for or made, answered and undone.
 */
export const SettingsApi = RpcGroup.make(
  call('GetSettings', {}, AppSettings),
  /** The presets the person has, in a project where one is named: built in, then their own. */
  call('ListPresets', { projectId: Schema.optional(Schema.String) }, Schema.Array(Preset)),
  /** Turns Althar's co-authoring of commits and pull requests on or off; the agents' own credit lines go either way. */
  command('SetCoAuthor', { on: Schema.Boolean }, Schema.Void),
  /** Whether a review of the person's team's pull request posts itself once drafted; an outside one always waits. */
  command('SetPostTeamReviews', { on: Schema.Boolean }, Schema.Void),
  /** What "Run it" on code from outside the team does without asking: ask each time, run safely, or trust it fully. */
  command('SetRunOutside', { to: Schema.Literals(['ask', 'safe', 'full']) }, Schema.Void),
  /** What sending a message does while an agent is mid-turn: queue it, or steer the agent with it at once. */
  command('SetSendMidTurn', { to: Schema.Literals(['queue', 'steer']) }, Schema.Void),
  /** Makes a route the person's default for every Ship, as Make this my default does; null goes back to each task's own. */
  command('SetShipRoute', { route: Schema.NullOr(ShipRoute) }, Schema.Void),
  /**
   * Saves a preset: a task's parts, team and first lines of its brief (Save as preset), or the parts the coordinator offered;
   * kept to the task's project with `projectOnly`. Its name, as kept.
   */
  command(
    'SavePreset',
    {
      name: Schema.String,
      taskId: Schema.optional(Schema.String),
      parts: Schema.optional(PresetParts),
      projectOnly: Schema.optional(Schema.Boolean),
      /** Only as a new preset, as a card's offer keeps one: a name another preset has is refused rather than replaced. */
      asNew: Schema.optional(Schema.Boolean),
    },
    Schema.Struct({ name: Schema.String }),
  ),
  /** Removes one of the person's presets; a built-in one stays. */
  command('RemovePreset', { id: Schema.String }, Schema.Void),
  /** Says not to offer a task's parts as a preset: its card stops offering them, and they aren't offered again. */
  command('DeclinePresetOffer', { taskId: Schema.String }, Schema.Void),
  /** Edits one of the person's presets, from Settings: its name, its parts, and whether it is kept to its task's project. */
  command(
    'EditPreset',
    { id: Schema.String, name: Schema.String, parts: PresetParts, projectOnly: Schema.optional(Schema.Boolean) },
    Schema.Void,
  ),
  /**
   * Tunes a built-in preset as the person's own, from Settings: its lead and reviewer, their efforts, and its brief. The
   * built-in itself names no model; nothing differing from it, it is back to its default.
   */
  command('TunePreset', { id: Schema.String, tuning: PresetTuning }, Schema.Void),
  /** Takes a built-in preset back to its default, the person's tuning gone. */
  command('ResetPreset', { id: Schema.String }, Schema.Void),
  /**
   * Picks another preset for a plan before it starts (a task is a conversation plus parts, "How a task starts"), by its id or
   * name: the plan's parts change to match. The preset's name.
   */
  command('ApplyPreset', { planId: Schema.String, preset: Schema.String }, Schema.String),
  /** Whether a pull request Althar opens says how its change was reviewed: the seal and the folded review. */
  command('SetReviewSeal', { on: Schema.Boolean }, Schema.Void),
  /** How the review seal looks. */
  command('SetReviewSealStyle', { style: SealStyle }, Schema.Void),
  /** The person answers an agent's card asking to change a setting that loosens what asks: yes makes it, as their own change. */
  command('AnswerSettingChange', { itemId: Schema.String, yes: Schema.Boolean }, Schema.Void),
  /** Puts back what an agent changed a setting from, as its line shows it: the person's press, so it goes at once. */
  command('UndoSettingChange', { itemId: Schema.String }, Schema.Void),
  /**
   * The settings an agent changed last and that are still as it left them, with who and when (ADR-097): a project's, or,
   * with no project, Althar's own.
   */
  call('GetSettingChanges', { projectId: Schema.NullOr(Schema.String) }, Schema.Array(SettingChanged)),
  /**
   * How many agents may be at work at once on this machine, from now on:
   * the person's number, or, null, the default again. What waits starts if
   * there is room now.
   */
  command('SetAgentsAtOnce', { count: Schema.NullOr(AtOnceCount) }, Schema.Void),
  /** Changes how plans start and how long review goes on, from the next plan or round; what isn't given stays. */
  command(
    'SetPlansAndReviews',
    {
      countdown: Schema.optional(PlansAndReviews.fields.countdown),
      rounds: Schema.optional(PlansAndReviews.fields.rounds),
      roundsOut: Schema.optional(PlansAndReviews.fields.roundsOut),
    },
    Schema.Void,
  ),
  /** Changes what the rules of projects made from now on start with; a project made earlier keeps its own. What isn't given stays. */
  command(
    'SetNewProjectDefaults',
    {
      usageLimit: Schema.optional(NewProjectDefaults.fields.usageLimit),
      rotateAccounts: Schema.optional(NewProjectDefaults.fields.rotateAccounts),
      accountStrategy: Schema.optional(AccountStrategy),
      end: Schema.optional(NewProjectDefaults.fields.end),
      pushCommits: Schema.optional(NewProjectDefaults.fields.pushCommits),
      postScreenshots: Schema.optional(NewProjectDefaults.fields.postScreenshots),
      resolveConflicts: Schema.optional(NewProjectDefaults.fields.resolveConflicts),
      moveIssues: Schema.optional(NewProjectDefaults.fields.moveIssues),
      afterMergeReview: Schema.optional(NewProjectDefaults.fields.afterMergeReview),
    },
    Schema.Void,
  ),
).middleware(ClientAuthority)

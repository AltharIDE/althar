import { Schema } from 'effect'

/*
 * The Settings screens' sections, by the ids their addresses name: Althar's
 * own, then a project's. The screens list them down their side in these
 * orders, and the agents' `read_settings` and `change_settings` name them the
 * same way, `althar/plans-and-reviews` or `project/rules` (ADR-097), so a
 * section a screen shows is one the agents read too.
 */

export const SETTINGS_SECTIONS = [
  'agents',
  'skills',
  'code-hosts',
  'this-mac',
  'plans-and-reviews',
  'new-projects',
  'reviews',
  'notifications',
  'dictation',
  'appearance',
  'editor',
  'browser',
  'about',
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const PROJECT_SETTINGS_SECTIONS = ['general', 'code', 'rules', 'running', 'notes'] as const
export type ProjectSettingsSection = (typeof PROJECT_SETTINGS_SECTIONS)[number]

/** Who changed a setting: the person, the coordinator, or a task's lead, by its task. */
export const SettingChanger = Schema.Struct({
  kind: Schema.Literals(['person', 'coordinator', 'lead']),
  /** The task whose lead it was, and its title; null for the others. */
  taskId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
})
export type SettingChanger = typeof SettingChanger.Type

/** One setting a change moved: its words as the screen shows them, and what it was and is, in words. */
export const SettingMove = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  before: Schema.String,
  after: Schema.String,
})
export type SettingMove = typeof SettingMove.Type

/**
 * An agent's change to a setting, in its thread (ADR-097): a line with what
 * changed, before and after, and Undo; or, where it loosens what asks and no
 * message of the person's in that turn asked for it, a card they press. Once
 * pressed, undone, declined or overtaken, one line saying so.
 */
export const SettingChangeCard = Schema.Struct({
  /** The change as recorded, which Undo names; null on a card not yet pressed. */
  changeId: Schema.NullOr(Schema.String),
  /** The section, as its address names it: `project/rules`, `althar/plans-and-reviews`. */
  section: Schema.String,
  /** The section's title, as the screen shows it. */
  title: Schema.String,
  /** The project it is of, by name; null for Althar's own. */
  project: Schema.NullOr(Schema.String),
  moves: Schema.Array(SettingMove),
  by: SettingChanger,
  /** It loosens what asks: an agent can't make it on its own word. */
  loosens: Schema.Boolean,
  /** The person's words it acted on, where it did. */
  words: Schema.NullOr(Schema.String),
  /** Why the agent asks, on a card. */
  why: Schema.NullOr(Schema.String),
  /**
   * asked: a card waiting for the person; done: made, with Undo; undone; declined: the person said not now; moot: the setting
   * moved on since, so nothing was done.
   */
  state: Schema.Literals(['asked', 'done', 'undone', 'declined', 'moot']),
  /** What became of it, where that needs saying: why it was moot. */
  said: Schema.NullOr(Schema.String),
})
export type SettingChangeCard = typeof SettingChangeCard.Type

/** Who last changed a setting an agent changed, and when, while it is still as they left it. */
export const SettingChanged = Schema.Struct({
  section: Schema.String,
  key: Schema.String,
  label: Schema.String,
  by: SettingChanger,
  at: Schema.String,
  /** The thread its line is in, to open from Settings. */
  threadId: Schema.NullOr(Schema.String),
})
export type SettingChanged = typeof SettingChanged.Type

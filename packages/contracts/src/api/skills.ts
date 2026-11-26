import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { call, ClientAuthority, command } from './rpc'

/** Where an installed skill came from: GitHub, or a folder the person imported. Althar ships none of its own. */
export const SkillSource = Schema.Literals(['github', 'local'])

/** One installed skill, as the skills page lists it. */
export const InstalledSkill = Schema.Struct({
  id: Schema.String,
  source: SkillSource,
  description: Schema.NullOr(Schema.String),
  license: Schema.NullOr(Schema.String),
  /** For one from GitHub: the repository, the folder in it, the ref it was installed from and the commit it is at. */
  repo: Schema.NullOr(Schema.String),
  subpath: Schema.NullOr(Schema.String),
  ref: Schema.NullOr(Schema.String),
  sha: Schema.NullOr(Schema.String),
  treeHash: Schema.String,
  review: Schema.Literals(['not-reviewed', 'reviewed']),
  /** Whether later runs are given it. */
  active: Schema.Boolean,
  /** Whether it has an earlier version to go back to. */
  canRollBack: Schema.Boolean,
  /**
   * Why it is broken, in words for the person, where Althar can't read what it keeps of it (its record or its stored
   * files): listed on its own, given to no run, while the rest are listed as they are (ADR-047). Absent when it reads.
   */
  problem: Schema.optional(Schema.String),
})
export type InstalledSkill = typeof InstalledSkill.Type

/** The skills store: off where the runtime has none. */
export const SkillList = Schema.Struct({
  enabled: Schema.Boolean,
  skills: Schema.Array(InstalledSkill),
})
export type SkillList = typeof SkillList.Type

export const SkillFinding = Schema.Struct({
  level: Schema.Literals(['reject', 'flag']),
  code: Schema.String,
  message: Schema.String,
  path: Schema.optional(Schema.String),
})

/** What a person reads before a version of a skill from GitHub is installed (`@althar/skills`' review card). */
export const SkillReviewCard = Schema.Struct({
  id: Schema.String,
  source: Schema.Struct({
    kind: Schema.Literal('github'),
    repo: Schema.String,
    ref: Schema.String,
    sha: Schema.String,
    subpath: Schema.String,
  }),
  treeHash: Schema.String,
  name: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  license: Schema.NullOr(Schema.String),
  instructions: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String, bytes: Schema.Int, sha256: Schema.String, executable: Schema.Boolean })),
  findings: Schema.Array(SkillFinding),
  installable: Schema.Boolean,
  installed: Schema.NullOr(
    Schema.Struct({
      source: SkillSource,
      treeHash: Schema.String,
      review: Schema.Literals(['not-reviewed', 'reviewed']),
      active: Schema.Boolean,
      repo: Schema.optional(Schema.String),
      subpath: Schema.optional(Schema.String),
      sha: Schema.optional(Schema.String),
    }),
  ),
  changes: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      change: Schema.Literals(['added', 'removed', 'changed']),
      lines: Schema.Array(Schema.Struct({ kind: Schema.Literals(['same', 'added', 'removed']), text: Schema.String })),
    }),
  ),
})
export type SkillReviewCard = typeof SkillReviewCard.Type

/** The skill folders a GitHub repository holds at the commit its ref names now, to choose one to review. */
export const SkillsFound = Schema.Struct({
  repo: Schema.String,
  ref: Schema.String,
  sha: Schema.String,
  paths: Schema.Array(Schema.String),
})
export type SkillsFound = typeof SkillsFound.Type

/** One GitHub skill's update check: current, a newer version to review, or why it couldn't be checked. */
export const SkillUpdate = Schema.Union([
  Schema.Struct({ id: Schema.String, state: Schema.Literal('current'), sha: Schema.String }),
  Schema.Struct({ id: Schema.String, state: Schema.Literal('available'), card: SkillReviewCard }),
  Schema.Struct({ id: Schema.String, state: Schema.Literal('failed'), error: Schema.String }),
])
export type SkillUpdate = typeof SkillUpdate.Type

/**
 * The skills a task's lead is given: listing them, finding and staging one from GitHub, approving it.
 * Checking for updates, rolling back and uninstalling.
 */
export const SkillsApi = RpcGroup.make(
  /** The skills a task's lead is given: what the person added from GitHub and turned on. */
  call('ListSkills', {}, SkillList),
  /** The skill folders in a GitHub repository (a URL or `owner/name`), at the ref given or its default branch. */
  call('FindSkills', { source: Schema.String, ref: Schema.optional(Schema.String) }, SkillsFound),
  /** Fetches one skill from GitHub at the commit its ref names now and returns its review card; nothing is installed. */
  call('StageSkill', { repo: Schema.String, ref: Schema.String, subpath: Schema.String }, SkillReviewCard),
  /** Installs the version on a card the person approved, active; `replace` puts it in place of one of the same name from elsewhere. */
  command(
    'ApproveSkill',
    {
      id: Schema.String,
      repo: Schema.String,
      ref: Schema.String,
      sha: Schema.String,
      subpath: Schema.String,
      treeHash: Schema.String,
      replace: Schema.optional(Schema.Boolean),
    },
    InstalledSkill,
  ),
  /** Checks each skill installed from GitHub for a newer commit on its ref; a newer one comes back as a card to review. */
  call('CheckSkillUpdates', {}, Schema.Array(SkillUpdate)),
  /** Puts a skill back to the version before its last update. */
  command('RollBackSkill', { id: Schema.String }, InstalledSkill),
  /** Removes a skill the person installed; one Althar ships can only be turned off. */
  command('UninstallSkill', { id: Schema.String }, Schema.Void),
).middleware(ClientAuthority)

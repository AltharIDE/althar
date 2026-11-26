import { Schema } from 'effect'
import { RpcGroup } from 'effect/rpc'
import { call, ClientAuthority, command } from './rpc'
import { FolderWait } from './shared'

/** How a finished task ended, which its folder's wait goes by. */
export const FolderKind = Schema.Literals(['merged', 'done', 'abandoned', 'review'])
export type FolderKind = typeof FolderKind.Type

/**
 * Why a finished task's folder stays though Clean up runs or its wait is
 * up: changes in it not committed, a change's commits pushed nowhere,
 * something running from it, opened in an editor from Althar within the
 * day, or git couldn't say what is in it. The person can still remove it by
 * hand, but while something runs from it.
 */
export const FolderHold = Schema.Literals(['uncommitted', 'unpushed', 'running', 'opened', 'unreadable'])
export type FolderHold = typeof FolderHold.Type

/**
 * What holds a finished task's folder, the gravest where several do:
 * something running from it, then what would be lost with it, then its
 * being opened lately; and how many of what (files not committed, commits
 * pushed nowhere).
 */
export const FolderHeld = Schema.Struct({ why: FolderHold, count: Schema.NullOr(Schema.Int) })
export type FolderHeld = typeof FolderHeld.Type

/** A finished task's folder still on this computer: its task, how and when it ended, its size, and what holds it, if anything. */
export const FinishedFolder = Schema.Struct({
  taskId: Schema.String,
  threadId: Schema.String,
  title: Schema.String,
  project: Schema.String,
  kind: FolderKind,
  settledAt: Schema.String,
  /** What removing it frees, in bytes, its repositories' folders together: what their files hold that nothing outside them shares, not clones or hardlinks of a package manager's store; null until measured. */
  bytes: Schema.NullOr(Schema.Number),
  /** Why it stays; null where nothing holds it. */
  held: Schema.NullOr(FolderHeld),
})
export type FinishedFolder = typeof FinishedFolder.Type

/** Finished tasks' folders on this computer, and the disk they are on. */
export const TaskFolders = Schema.Struct({
  /** The disk the folders are on, in bytes: its size and what is used; null where it couldn't be read. */
  disk: Schema.NullOr(Schema.Struct({ total: Schema.Number, used: Schema.Number })),
  /** Every finished task's folder still here, the latest settled first. */
  folders: Schema.Array(FinishedFolder),
  /** Some sizes are still being measured; the feed says once they are (`folders`). */
  measuring: Schema.Boolean,
})
export type TaskFolders = typeof TaskFolders.Type

/** A place Althar keeps data, by the id the window asks for it with (About › Storage). */
export const PLACES = ['profile', 'logs', 'worktrees'] as const
export const PlaceId = Schema.Literals(PLACES)
export type PlaceId = typeof PlaceId.Type

/** What measuring a place came to: bytes (approximate where the time was up, a lower bound too where entries couldn't be read), or that it isn't there, or couldn't be read. */
export const StorageSize = Schema.Union([
  Schema.Struct({ state: Schema.Literal('done'), bytes: Schema.Number, approximate: Schema.Boolean, unreadable: Schema.Int }),
  Schema.Struct({ state: Schema.Literal('missing') }),
  Schema.Struct({ state: Schema.Literal('failed') }),
])
export type StorageSize = typeof StorageSize.Type

/** What removing finished tasks' folders freed, in bytes, as they were measured just before they went; and how many it couldn't remove. */
export const FoldersFreed = Schema.Struct({ freed: Schema.Number, failed: Schema.Int })
export type FoldersFreed = typeof FoldersFreed.Type

/**
 * Finished tasks' folders on this computer and the storage Althar takes.
 * Cleaning them up, removing one, and when they go.
 */
export const FoldersApi = RpcGroup.make(
  /** When finished tasks' folders go from now on; a sweep runs at once by it. */
  command('SetFolderWait', { wait: FolderWait }, Schema.Void),
  /** Finished tasks' folders on this computer, with the disk they are on: sizes not yet measured start being measured. */
  call('GetTaskFolders', {}, TaskFolders),
  /**
   * What a place Althar keeps data in takes on disk, as the same walk counts what removing task folders frees. Kept for the session; `refresh` measures again, for longer. Giving up on the call (About closed) stops the walk when no one else waits on it.
   */
  call('GetStorageSize', { place: PlaceId, refresh: Schema.Boolean }, StorageSize),
  /** Removes every finished task's folder nothing holds, whatever its wait; their branches stay, and each comes back when its task needs it. */
  command('CleanUpFolders', {}, FoldersFreed),
  /**
   * Removes one finished task's folder by hand, though something holds it,
   * but while something runs from it. `seen` is what the person was told
   * holds it as they chose to: where more would be lost with it now, it
   * stays, refused (`ChangedSinceSeen`).
   */
  command('RemoveTaskFolder', { taskId: Schema.String, seen: Schema.NullOr(FolderHeld) }, FoldersFreed),
).middleware(ClientAuthority)

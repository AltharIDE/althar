# Undoing a chat turn

Source review on 13 November 2026, for reverting a delivered prompt and its code changes. This is separate from restoring a deleted chat.

## T3 Code

Reviewed [pingdotgg/t3code](https://github.com/pingdotgg/t3code/tree/0bb6eaa546c91915efbd3f092088c694f3949709).

- [`useTimelineRewind`](https://github.com/pingdotgg/t3code/blob/0bb6eaa546c91915efbd3f092088c694f3949709/apps/web/src/components/chat/useTimelineRewind.ts) asks for confirmation, offers conversation rewind with an explicit file-restore choice, checks provider rollback support, blocks while a turn is running, and returns the chosen prompt to the composer.
- [`CheckpointRestoreSafety`](https://github.com/pingdotgg/t3code/blob/0bb6eaa546c91915efbd3f092088c694f3949709/apps/server/src/orchestration-v2/CheckpointRestoreSafety.ts) checks workspace ownership both when work is admitted and when files are restored. Shared project folders and side chats can make a checkout unsafe to restore.
- [`CheckpointRollbackService`](https://github.com/pingdotgg/t3code/blob/0bb6eaa546c91915efbd3f092088c694f3949709/apps/server/src/orchestration-v2/CheckpointRollbackService.ts) coordinates file checkpoints and provider conversation rollback. Rolled-back turns remain in audit history, while no longer belonging to the provider conversation.

The useful pattern is a boundary shared by files, conversation and composer, with ownership rechecked at restore time.

## Paradev

Reviewed [ParadevAI/Paradev](https://github.com/ParadevAI/Paradev/tree/ef07711879b8560b8e02c3eef4d147f2d0d7ce1f).

- [`gitCheckpoints`](https://github.com/ParadevAI/Paradev/blob/ef07711879b8560b8e02c3eef4d147f2d0d7ce1f/packages/host-service/src/chat-v3/gitCheckpoints.ts) captures turn boundaries in a host worker, serializes checkpoint work per folder, and marks overlapping chat spans as shared. Large snapshots can time out without blocking the prompt indefinitely.
- [`checkpoints/undo`](https://github.com/ParadevAI/Paradev/blob/ef07711879b8560b8e02c3eef4d147f2d0d7ce1f/packages/host-service/src/workers/tasks/checkpoints.ts) uses private Git refs and a separate index. It restores plain files only when they still contain the turn's result; files changed since are skipped and listed. HEAD and the branch stay put. An undone snapshot records which paths were skipped, and shared turn results are refused.

The useful pattern is comparing each affected path with its captured result before writing, preserving unrelated work and making any skipped paths visible.

## Applied in Althar

Althar combines the conversation boundary with selective path comparison, using private snapshots around delivered task turns. It refuses the entire operation on a conflict across any workspace, preserves Git history and unrelated edits, and returns the removed prompts and attachments to the draft. Provider independence comes from ending the idle session and briefing a fresh session with only retained items. A durable journal and versioned thread reads cover interrupted restores and other windows. The first slice requires complete checkpoints in idle private task worktrees; it does not reverse external actions or offer redo.

The decision is [ADR-105, Undo from a task message](../decisions/desktop-app.md#undo-from-a-task-message).

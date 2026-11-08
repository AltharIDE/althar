# ADR-105: Comments on diff lines go to the lead with their file, lines and code

- **Status:** Accepted
- **Date:** 2026-11-08
- **Owner:** Runtime, contracts and desktop app maintainers
- **Context:** In a task's diff (Outputs → Review the diff, ⌘D) the person
  could only read. To say something about a line they had to name the file
  and line in the composer, and the lead had to find it. DEV-175 lets them
  pick a line or a range, write about it, gather several, and send them
  together. That needs a new shape on the person's message, in the contracts
  and in what the runtime keeps.
- **Decision:**
  - **A comment is a value of its own (`LineComment`).** It holds a file as the
    Changes view names it, with the repository's slug first in a task of
    several. It holds a side: `new` for the file as the task has it, `old` for
    lines the change only took out, with `under` the new line they were taken
    out after. It holds a first and last line, the code as it showed (each line
    unchanged, added or removed) and what the person said. Limits are in
    `LINE_COMMENTS`: 30 a message, 80 quoted lines a comment.
  - **It rides on a message.** `Send` and `SwitchAgent` take `comments`. No
    new call sends them on their own: a message and its comments are one input
    for the lead and one turn. The command's envelope says how many comments
    there are, not what they say.
  - **The lead reads text.** After the person's words come "N comments on
    the diff:". Then each comment gives its file and lines in turn, with "as
    the file was before the change" for a removed line. Its code is fenced in
    the file's language, or as a diff where a line was taken out, in a fence
    longer than any run of backticks in it. What the person said comes last.
    No agent needs to know a new shape.
  - **The thread shows them on the person's message.** `UserMessageItem`'s
    content has an optional `comments` (`SentLineComment`: the comment with
    an id). The bubble shows each comment's excerpt after the words. An
    excerpt opens the diff at its line.
  - **Addressed is worked out, never stored.** The runtime keeps each
    comment with its worktree's tree and HEAD as they were when it was sent.
    `GetLineComments` reads them back with where each comment's first line
    is now, carried past what changed since. A comment is `addressed` once a
    commit since it was sent changed its file and touched its lines. What
    isn't committed yet doesn't count.
- **Consequences:**
  - Older clients and agents need nothing new: the field is optional, and
    the lead gets plain text.
  - A comment whose lines no longer show in the change is listed above its
    file. One whose worktree is gone has no place and is never addressed.
  - Posting these comments to GitHub as a review is left out. The shape is
    close enough to a review comment to be mapped later.

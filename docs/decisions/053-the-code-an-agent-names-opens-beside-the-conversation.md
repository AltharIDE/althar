# ADR-053: The code an agent names opens beside the conversation, read where the agent works, and never edited

- **Status:** Accepted
- **Date:** 2026-10-19
- **Owner:** Repository maintainers
- **Context:** Leads and the coordinator name code all the time:
  `packages/runtime/src/Runs.ts:359`, a file's name, a function. Nothing in
  Althar opened any of it, so the person left for their editor and found the
  file by hand to understand what an agent meant. The person wants to
  understand what the agent is talking about without Althar becoming a code
  editor. A prototype tried five ways (a panel over the conversation, a
  snippet under the message, a peek with a panel, a split view, a reading
  pane); the person picked the peek with a panel, then asked that the panel
  be calmer, resizable, and the start of a general right-hand side, a
  workbench, that could later hold a browser or a log.
- **Decision:**
  - **A name in what an agent wrote that names code is a chip** (the kit's
    `CodeRef`, from `Markdown` wherever the thread's host offers
    `ThreadShell.code`): a path in backticks, with its lines (`:12`,
    `:12-30`, `#L12-L30`), a file's name, a name in code as one reads
    (camelCase, snake_case, `called()`), and a path written into the words.
    The window asks the runtime which of them are code (`FindCode`); what
    isn't stays code text. Pointed at, the chip peeks at the lines named
    and a few around them; pressed, the whole file opens beside the
    conversation; ⌘-pressed, in the person's editor. ⌥↓ and ⌥↑ step through
    the thread's names.
  - **It is read where the agent works.** A lead's names, in its task's
    worktrees as they are, what isn't committed and its scratch notes too;
    the coordinator's, on each repository's default branch as this device
    last fetched it, its message's lines followed from the commit the branch
    was at when it was said through `git diff` to where they are now, or
    shown as they were where those lines were rewritten since. A file's
    name alone is the one file of that name, or the one in a folder the
    message names; a name in code, the one file that declares it, tests
    aside; several, a choice; a path that isn't there says so, with files of
    nearly its name. Only text is shown, whole up to a megabyte and past it
    the lines around those named; nothing is kept.
  - **The right side of the conversation is a workbench** (the kit's
    `Workbench`): one column for what opens beside the thread, a lead's
    document or a file, one at a time, beside it and never over it, in the
    page's raised tone, as wide as the person drags its edge (kept as
    `althar.bench`, leaving the conversation 420 px). What opens from inside
    it, a file a document names, goes on top, with Back. Beside the board,
    where the conversation is too narrow to share, it opens over the board.
  - **Althar never edits.** The panel opens the file in the person's editor
    (`OpenCode`, the editor Settings chooses, the first found until then): a
    task's in its folder, the coordinator's in the person's own checkout,
    its folder alone where the file isn't there, as on another branch.
  - **Files are coloured by Shiki** (with its JavaScript engine, no
    WebAssembly), each language's grammar loaded the first time a file of it
    shows, in the kit's syntax inks as CSS variables, which code blocks in
    messages share.
- **Alternatives considered:**
  - *A file tree, tabs of files, or editing.* Each makes Althar an editor,
    which the person ruled out; the editor is one press away.
  - *Resolving every name in the window from what the thread already
    holds.* The window doesn't have the files or git; and only the runtime
    may read a task's worktree.
  - *Reading the coordinator's names as main is now.* Its line numbers go
    stale as soon as main moves; following them through the diff since it
    spoke keeps them pointing at what it meant.
  - *Our own highlighter.* The prototype's was tuned for the languages this
    project's agents name; real grammars cover every language a project
    has, and are maintained by others.
- **Trade-off:** Every message that names code asks the runtime once, in one
  question for the messages that show together, and a name may be read as a
  chip only once the answer comes. A name is a heuristic: a word in
  backticks that reads like code but declares nothing stays code text, and
  a symbol declared in several files isn't guessed. A lead's lines aren't
  followed: what it said about uncommitted work can't be read as it was.
  The grammars add to the app's download, though none loads until needed.
- **Revisit when:** something else needs the workbench (a page of what
  runs, a check's log), or agents name code in ways these forms miss, or a
  lead's lines need following too.

# ADR-017: What agents hand back is kept in the artifact store, by digest

- **Status:** Accepted
- **Date:** 2026-10-10
- **Owner:** Repository maintainers
- **Context:** Agents hand back more than words: a screenshot from a browser
  tool, a picture a tool read, a document they wrote, a file they point at,
  and a command's output. Althar dropped all of it. The adapter kept only a
  tool call's command and paths, and the runtime's rule was "until there is
  an artifact store, output isn't kept" (07: no file contents, so no
  secrets, in the store). What each agent sends, as of claude-agent-acp
  0.88, codex-acp 2.1.1 and OpenCode 1.18:
  - **Claude Code:** a picture in a tool's result as an ACP `image` block
    (base64), rarely one in a message. A command's output comes whole when
    it ends: as a ```` ```console ```` text block, or, to a client that asks
    with `_meta.terminal_output_delta`, as `_meta.terminal_output_delta`
    with `terminal_exit` (its exit code). Nothing streams while it runs.
  - **Codex:** a command's output streams as `_meta.terminal_output_delta`
    chunks, with `terminal_exit`, but to an AIR client (Althar declares
    itself one, for structured failures) only when it asks. A generated
    picture is an `image` block; `view_image` and tools' pictures are
    `resource_link`s to a path or a `data:` address.
  - **OpenCode:** a command's output is the tool's own text content, whole
    each time while it runs and at its end, its exit code in
    `rawOutput.metadata.exit`. A picture a tool read is an `image` block.
    Messages are words only.
  - All three send a new file as an ACP `diff` without old text, except
    OpenCode's write, whose whole content is in its input.
- **Decision:**
  - **Althar asks for command output** (`terminal_output_delta: true` in
    its client capabilities) and the adapter normalizes what each agent
    sends: content blocks (pictures, links, resources), diffs (a path, and
    whether the file is new, never its text), and terminal output and exit.
  - **Bytes go to the artifact store, never to a row** (07's design, built
    for the first time): files under the profile named by their SHA-256,
    written aside, flushed and renamed into place before the `artifacts`
    row and its `artifact_links` row are committed. The same picture twice
    is one file and one row. A thread item keeps what a picture is (its
    digest, type, size in bytes and pixels) or why it wasn't kept.
  - **What is kept, and how much:** a picture up to 20 MB, of a kind the
    window draws (PNG, JPEG, GIF, WebP, told by its bytes, not the type an
    agent claims), as kind `image`; a command's output once it ends, its
    last 256 KB cut at a line, with how many lines before it weren't kept,
    as kind `log`. Both are marked `may_contain_secrets`. A picture a link
    points at is read only from inside the folders the agent works in, links
    followed both sides, or from a `data:` address. A file is kept by its
    path alone.
  - **Running output isn't written while it runs.** The runtime holds it in
    memory and sends its last 400 lines to watching windows, at most every
    50 ms, as `Output`; it is kept when the command ends, or when its turn
    ends.
  - **The window reads past what an item says, when the person looks:** a
    command's output (`ReadOutput`) when its tool call opens, or, while it
    runs, what it printed before the window started listening; a markdown
    document an agent wrote (`ReadDocument`), from the task's worktree as it
    is now, up to 1 MB, never kept. A picture is served by the main process
    at `althar-picture://shot/<digest>` from the store, without the
    database, with a smaller copy (1120 px wide) made once with Chromium's
    decoder and kept beside the store; the window decodes it lazily, off
    the main thread, in a box that holds its shape. The window never names
    a path.
- **Alternatives considered:**
  - **Base64 in the item's JSON.** Simplest, but every read of a thread
    carries megabytes, the database, its WAL and its backups grow with every
    screenshot, and 07 says not to.
  - **Output inline in the item, bounded.** Small, but it puts what a
    command printed (a token, a password) in the canonical record, and
    every page of the thread carries it.
  - **Bytes to the window over the API.** Every message is checked against
    its schema and serialized; a picture would cross the port as a string,
    and decoding it as a blob would hold it in the page's memory. The
    browser's own image pipeline over a scheme of Althar's caches, decodes
    off the main thread and drops what is off screen.
  - **Keeping output only in memory.** It would show while a command runs
    and be gone after a restart.
- **Trade-off:**
  - **Nothing is swept yet.** Files whose rows are gone, and old pictures
    and logs, stay until mark-and-sweep is built (07); the store grows with
    use. Retention per kind is still to decide (open questions).
  - **Output is its end.** A long run keeps its last 256 KB; its start is
    counted, not kept.
  - **A document shows as it is now,** not as it was when the agent wrote
    it, and is gone once the worktree is.
  - **Claude Code's output doesn't stream:** its adapter sends it once, at
    the end.
- **Revisit when:**
  - Retention and garbage collection are designed, or the profile's size
    becomes a complaint.
  - A project is linked to the cloud: artifacts need their upload policy
    and visibility (07).
  - Claude Code's adapter streams command output.

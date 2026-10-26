# ADR-061: A file sent with a message is copied where the agent reads, and linked

- **Status:** Accepted
- **Date:** 2026-10-26
- **Owner:** Repository maintainers
- **Context:** The composer took images only (PNG, JPEG, GIF, WebP), sent
  to an agent as ACP `image` blocks, and refused anything else dropped on
  it. People want to hand an agent a PDF, a log, a CSV, a spec, a zip or a
  folder, in a task's thread and in the coordinator's alike. ACP's
  baseline, which every agent must accept, is a `resource_link` (an
  address, name, type and size), which the agent opens with its own tools;
  an agent that says `promptCapabilities.embeddedContext` also takes a
  `resource` with a text file's words. What the two bundled agents make of
  them, read from their code: claude-agent-acp 0.95 shows a link as
  `[@name](file:///…)`, naming it by the address's last part; a text
  resource as the link, and the words in a `<context ref="…">` at the end
  of the message; a binary one (`blob`) it drops. codex-acp 2.2 shows a
  link the same way, by the name sent; a text resource as the link with
  its `<context>` under it; a binary one it pastes in as base64. Both say
  they take embedded context. So a link is what every agent can open, and
  the file has to be somewhere the agent can read. The person's file is
  usually in Downloads or on the Desktop, which a lead's sandbox may not
  let it read without asking, and which the coordinator's sandbox
  (ADR-058) doesn't let it read at all.
- **Decision:**
  - **Any file or folder goes.** Images keep going as images, drawn small,
    to an agent that takes them; anything else, a folder, or an image for
    an agent that doesn't take images, goes as a file: a chip with its
    name and size, in the composer's tray and on the sent message. A
    message carries at most 10 files and folders, each at most 50 MB (a
    folder, all its files, at most 2,000 of them), and at most 100 MB in
    all (`MESSAGE_FILES`). Dropping, pasting a file copied in the file
    manager, and picking with Add files work alike.
  - **The window never has the path.** The main process measures what is
    added (`main/attachments.ts`, the runtime's `measure`) and grants it to
    the runtime, as a dropped project folder is (`Folders`); the window
    gets the grant, the name and the size, and refuses at once, in the line
    over the field, what is too large. A file copied in the file manager
    and pasted is read off the clipboard by main, as each system names it
    there.
  - **Copied into the thread's own folder, under `.althar/attachments`.**
    As the message is sent, before its command runs, the runtime copies
    each into `.althar/attachments/<message>/` in the folder its agent
    starts from: a task's worktree, or the folder that holds a task's
    several, or the coordinator's folder, beside its copies of the
    repositories, which its turns make afresh without touching it. That
    folder's own `.gitignore` (`*`) keeps the copies out of git, so none
    is committed or pushed. A folder is copied without following a link in
    it; a dropped link is copied as what it points at.
  - **Linked in every turn that delivers the message.** Each copy goes as a
    `resource_link` to its `file://` address, a folder with
    `inode/directory`, to every agent. A text file of at most 100 KB
    (UTF-8, no NUL) goes as a `resource` with its words instead, to an
    agent that takes embedded context, so it needn't open it. No file goes
    as a `blob`. A copy that is gone by then is said in the prompt, so the
    agent can ask for it.
  - **Recorded with the message** (`user_input_files`, migration 0042: its
    name, kind, type, size, a folder's files, and its copy's path), and on
    the message's item, so the thread shows them after a restart, a
    message taken back from the queue goes again with the same copies, and
    an agent taking the thread over reads where they are in its brief. The
    command's payload says how many, never their names or paths.
  - **They go with the folder.** A task's copies are removed with its
    worktree or its folder when a finished task's folder goes (ADR-056).
- **Alternatives considered:**
  - **A folder of Althar's own, under its data folder, added to each
    agent's read paths:** the copies would outlive the task's folder and
    not depend on it being ready, but every agent's sandbox and Althar's
    rules would need it as a place an agent reads without asking (Claude
    Code's settings, Codex's config, the coordinator's `allowRead`, the
    reader rules for the agents with no sandbox), and its cleanup would be
    a second sweep beside the task folders'. Inside the folder the agent
    already works in, every agent reads it as it reads the task's files.
  - **Link the person's file where it is:** no copy, but the agent's
    sandbox often can't read Downloads, the coordinator's never can, and
    the file may change or go before the message is read.
  - **Send a file's words, or its bytes, in the prompt:** the words of a
    large log or a PDF's bytes fill the context whether or not the agent
    needs them, and Claude Code drops a `blob` while Codex pastes it in as
    base64. A link lets the agent read what it needs, as it reads the
    task's own files.
- **Trade-off:** a message with files can't be sent to a task whose folder
  isn't ready on this computer (being made, or removed after it finished):
  the composer says so. Copies take disk in the task's folder until it
  goes. An agent that cleans its worktree of ignored files (`git clean
  -x`) removes them; a later turn says a copy is gone.
- **Revisit when:** an agent reads files only through a protocol of its
  own rather than its tools, or Althar runs agents somewhere the window's
  computer isn't, when the bytes have to travel with the message.

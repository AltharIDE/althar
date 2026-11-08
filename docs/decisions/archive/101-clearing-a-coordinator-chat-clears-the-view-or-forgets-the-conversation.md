# ADR-101: Clearing a coordinator's chat clears the view, or forgets the conversation too

> Archived on 8 Nov 2026. What holds now is in [coordinator.md § Clearing its chat](../coordinator.md#clearing-its-chat); this is the record as it was.

- **Status:** Accepted
- **Date:** 2026-11-07
- **Owner:** Runtime and desktop app maintainers
- **Context:** A project's coordinator thread only grows. Its context fills
  and is compacted or handed over (ADR-031, ADR-039), but the thread the
  person reads never gets shorter, so an old topic stays between them and
  the next one. They had no way to start clean, nor to have the coordinator
  forget what it had learned. A prototype tried the control in the composer,
  in a bar above the thread, and in the context ring; the person settled on
  two acts of different weight in two places.
- **Decision:**
  - **One question, two kinds,** titled "Clear chat".
    - **Clear only the view** ("Only the view is cleared. The coordinator
      keeps the conversation."): the thread starts here. The session is
      untouched and nothing is freed from its context; Compact does that.
    - **Forget the conversation too** (red, "Clear and forget", "Can’t be
      undone."): the session ends and the conversation is deleted.
    - Neither is the default of a button: the kind is chosen with the
      choices and done with its own button. Enter and Escape never forget.
  - **Where it is asked.**
    - The view: a "Coordinator" bar above the thread on the project's
      Conversation view, with Clear in it; and `/clear` in the composer,
      which is not sent to the coordinator. The question opens on the view.
    - The conversation: "Clear chat…" in the context ring's foot, beside
      Compact. The question opens on forgetting, so it reads as a warning.
    - After the view is cleared the control stays, since the conversation is
      still there to forget; the view's option then says "The view is
      already clear."
  - **What the thread shows after.**
    - A cleared view: a line "Cleared · Show earlier · Undo" at its top.
      Show earlier reads the conversation before the clear in the thread's
      place, with "Back to now". Undo takes the clear back.
    - A forgotten conversation: a line "Fresh session", no undo.
    - The coordinator says nothing on its own after either. Its first word
      answers the person's next message: from the conversation it kept
      after a clear of the view, from the project's records after a forget.
  - **What both keep.** Tasks not settled, with their errands and plans;
    drafts and changes to issues waiting to be filed or applied; questions
    and asks waiting for an answer; the project's notes; the board. The
    clear of the view carries the cards among them into the view; the forget
    keeps them in the thread.
  - **How the view is stored.** Two columns on the coordinator's thread:
    `view_from`, the sequence where the cleared view begins (null until
    cleared), and `earlier_shown`. It belongs to the thread, so every window
    and every reload agrees, and a thread made before it has none.
    - The thread's pages start at the mark, or, with the earlier
      conversation shown, end before it. What is still open and came before
      the mark is carried in at the start. A window reads this through
      `CoordinatorSnapshot.view`, with the thread's revision as `version`: a
      window holding pages from another version starts over.
    - Nothing is deleted. `read_thread`, a handover's brief, the brief of any
      session the coordinator starts, and the agent's own memory all still
      reach what came before the mark.
    - A clear is refused, in words, when the view has nothing in it.
  - **What forgetting deletes.** `Sessions.forget`, under the thread's lock:
    it ends the session, cutting a turn short; withdraws what waits in its
    queue; deletes every item of the thread but those still open
    (`chatView.ts`), so `transcript`, `read_thread` and a handover's brief
    cannot reach them; takes the mark away; and writes the "Fresh session"
    line as a notice from Althar. The sessions, turns and inputs stay as the
    record of what ran; the next message starts a session on the agent
    picked last, briefed from the notes, errands and tasks as any first one.
    It is refused for any thread but a project's coordinator.
  - **Through the API.** `ClearView`, `ShowEarlier`, `UndoClearView` and
    `ForgetConversation`, each a command that replays by its id. A window that
    did not ask hears the thread change and reads it whole again.
- **Alternatives considered:**
  - **A Clear in the composer's row.** Next to send, and the wipe with it:
    the wrong place for what can't be undone.
  - **A mark kept in each window.** Windows would disagree, and a reload
    would bring the thread back.
  - **Deleting the items of a cleared view.** It is what the person asked
    not to lose: the coordinator, read_thread and Show earlier need them.
  - **Undo for forgetting,** by holding the deletion for a few seconds.
    The question says plainly that it can't be undone.
- **Trade-off:** a task that is done but has commits not yet shipped, and an
  automation's finished card, are not kept when the conversation is
  forgotten: they are on the board and in the tasks' own threads. Files a
  command printed stay on disk with the artifacts until the project is
  removed.

# ADR-079: Outputs show the change as built

- **Status:** Accepted
- **Date:** 2026-11-01
- **Owner:** Repository maintainers
- **Context:** A change's Outputs, and the screenshots comment on its pull
  request (ADR-077), counted every picture its lead showed since the task
  became a change. A task planned as a change from the start, whose lead ran
  a prototype round inside it, kept every direction beside the version it
  built: PR #476 showed nine pictures, four of them directions the person
  chose between, and posting would have put them all on the pull request.
  Views were matched only by a name in the caption (A1), which directions
  never come back with, so stale pictures piled up. The person asked on
  1 November for Outputs to stay up to date with the work.
- **Decision:**
  - **The lead says what each picture is.** finish_step's evidence takes,
    for a picture, a `view`: a short name the lead keeps for a view of the
    work as built, so a later picture of it replaces it; and `option`, for
    a direction the person chooses between or an exploration. A change's
    options never reach Outputs or the pull request; they stay in the
    thread, where the person saw them. A prototype's Outputs are its
    directions, so there they count.
  - **A later round replaces earlier ones.** A round that pictures the work
    replaces what came before, but for the views it takes again and those
    it names in `kept_views`. A round that only takes known views again is
    a follow-up, and leaves the other views as they were. A caption's name
    (A1) still counts as a view, for reports from before.
  - **A posted comment follows Outputs.** Once the person posts the
    screenshots to a pull request, the comment is written anew as Outputs
    change, as listening goes round, with the project's rule off too; the
    rule still decides whether Althar posts the first time. A view gone
    leaves the comment entirely; only a view taken again keeps its earlier
    pictures folded away.
- **Alternatives considered:**
  - _Only by name, as before:_ relies on leads naming every view and reusing
    the names; directions and first looks never go.
  - _Guessing options from captions (single letters, A · B · C):_ the same
    letters name views of built work too.
  - _Every round adds to the last:_ the failure this replaces.
- **Trade-off:** a round of something new that forgets `kept_views` drops
  views that still hold; it shows less, never something stale, and the
  lead's instructions say how to carry them.
- **Revisit when:** leads keep losing views they meant to keep, or people
  want options on the pull request to discuss them there.

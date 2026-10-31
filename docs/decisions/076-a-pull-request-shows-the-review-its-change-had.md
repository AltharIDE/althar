# ADR-076: A pull request shows the review its change had, as a seal in its corner and the review folded at its end

- **Status:** Accepted
- **Date:** 2026-10-31
- **Owner:** Repository maintainers
- **Context:** Before a task's pull request opens, a second model reviews
  its change, one to three passes, and the lead fixes what holds and sets
  aside what doesn't, with a reason. None of that reached the pull request:
  [DESCRIPTION_SHAPE](../../packages/runtime/src/pullRequestWords.ts) keeps
  the review out of what the lead writes, so a reader on the host saw a
  description and Althar's "Opened by" line, and nothing showed the change
  had been reviewed at all. The person wanted every pull request Althar
  opens to carry visible evidence of it. They said how many findings there
  were doesn't matter to anyone. A prototype offered three seals in the
  site's engraving style (a ring, a pressed wax seal, a printer's
  colophon). The person liked all three and asked for them as a choice in
  Settings, with the number of passes shown, and an on/off switch in the
  same design as Althar as co-author.
- **Decision:**
  - **What the description gains** (`pullRequestReview.ts`), where the run
    had a review and the person has it on:
    - At its head, the **seal**: an image floated right, naming the
      reviewer, how many passes, the commit the last pass read, as it was
      sent, and the day.
    - After the lead's description, the **review, folded** under "Reviewed
      by GPT-6.1 Sol in 3 passes, at `2f67c42`":
      - What changed after review, each line in the lead's words with the
        commit the lead said made it.
      - What was looked at and kept, each with the lead's reason.
      - A last line naming the model that built the change and the one that
        reviewed it.
    - It gives no counts of findings anywhere, and no severity.
  - **Where its words come from.** A finding's `reason`, which `finish_step`
    already took for one set aside, now says for a fixed one what changed,
    in a line, and the lead is asked for it. A fix without that line shows
    the reviewer's claim as fixed.
  - **Where its commits come from.** Nothing linked a finding to a commit,
    and guessing one from the files a pass touched would cite commits that
    didn't make the fix. So the lead names it: `finish_step`'s findings take
    a `commit` for one fixed, kept in the `finding.fixed` fact. It is shown
    only where it is a commit the lead made settling that pass, after where
    the pass started and by where the next one did; anything else names
    nothing. The commit the last pass read is the head its copy was made on
    only where nothing was left uncommitted. Otherwise it is the first
    commit after that holds the same tree, or none, and then there is no
    seal. Crediting makes commits again before they are pushed
    (`credit.ts`), so each sha goes through its memory: the sha shown is the
    one the host has.
  - **The seal is drawn by the site.** A code host shows an image only by
    its address, so the site has one Worker route, `/seal/<look>.svg`.
    - It draws the seal from its query: model, sha, passes, date, ink. It
      refuses anything a seal can't say, and serves the SVG with a year's
      `immutable` cache and a `sandbox` CSP.
    - The drawing is the kit's (`packages/ui/src/seal`). It is pure, with no
      React, so the Worker, Settings and the tests share it.
    - Its words are glyph outlines from Inter and JetBrains Mono, which
      `brand/scripts/seal-glyphs.ts` writes, because an `<img>` loads no
      fonts.
  - **One ink can't serve both themes.** The site's cobalt `#1f35c8` all but
    disappears on GitHub's dark page, so the seal is drawn in each ink and a
    `<picture>` picks by `prefers-color-scheme`. GitHub supports this in
    descriptions; GitLab's support is uncertain, so the seal goes only on
    GitHub. The folded review is plain HTML that both fold.
  - **Settings › Reviews and pull requests** gains "Review seal on pull
    requests", on by default and kept as a `settings` row only when off
    (`review_seal`, `review_seal_style`). Like co-author, a pull request as
    GitHub shows it sits under the switch. While on, the three looks are
    tiles to pick from (ring by default). Off, the seal leaves only its
    outline and the review's line is struck through.
  - **Written once.** A description is written when the pull request opens
    and never edited (the hosts' connectors can't edit one), so the section
    shows the passes before it opened. Rounds after it opened don't change
    it. Nothing it fails to read holds the pull request up: it opens
    without the section, and the failure is logged.
- **Alternatives considered:**
  - A shields.io badge or a check icon: rejected as generic. The seal
    belongs to the site's engraving family.
  - SVG text with a font stack: in an `<img>` it falls back to whatever the
    reader's machine has, so the same address would draw differently.
  - Embedding a font in each SVG: about 60 KB a seal, against about 10 KB
    of outlines.
  - Inferring each fix's commit from the pass's range and the finding's
    file: a later change to the file, or a fix in another file, would cite
    the wrong commit.
  - Editing the description after later rounds: no host connector can, yet.
- **Trade-off:** the seal depends on althar.ai being up when a reader's
  host first fetches it. Hosts' image proxies keep it after that, and its
  address never changes. A reviewer's name outside printable ASCII, or
  longer than 32 characters, gets no seal, only the section.
- **Revisit when:** a host connector can edit a description (to tell rounds
  after it opened too), or GitLab is known to honour `<picture>`.

# ADR-077: A task's screenshots go in one comment on its pull request

- **Status:** Accepted
- **Date:** 2026-10-31
- **Owner:** Repository maintainers
- **Context:** A task's Outputs show what it looks like: the screenshots its
  lead took, each view as last taken. Reviewers on GitHub or GitLab never see
  them; they check out the branch, or ask. The person asked on 31 October for
  them to live on the pull request too, kept up to date as the work changes,
  by a setting, and, with it off, to post them by hand from Outputs,
  "somewhere subtle", clear that what goes is what Outputs shows.
- **Decision:**
  - **What goes is what Outputs shows.** `screenshotsNow`
    (`@althar/contracts`) works out a task's screenshots as it is now, each
    view once as last taken; the window draws What it looks like by it, and
    the runtime posts by it, so the two can't differ. A view is a picture's
    name (A1) from its caption, else the picture alone.
  - **One comment, written anew.** The screenshots go in one comment on the
    pull request, which Althar edits as they change rather than adding one
    each time, so the conversation isn't buried in pictures and the comment
    is always the one to read. What a view showed before is folded away
    under the views as they are now (the newest 24). A hidden mark finds the
    comment again where Althar's record of it was lost, and one someone
    deleted is posted again. It is signed as Althar's replies are, so
    listening knows it as Althar's own and doesn't read it to the lead.
  - **An edit tells nobody,** so where someone reviewed after it was last
    written and it changed, a one-line comment says how many changed, and
    links it. With no review since, it is edited quietly.
  - **Uploaded to the host, never elsewhere.** GitHub through the uploads
    endpoint its own CLI attaches files with (`gh` 2.99, `--attach`), by the
    repository's id, which serves a picture to those who can see the
    repository; GitLab through a project's uploads. Both keep an upload for
    good, so each picture goes up once, by its digest. An address the host
    gives off its own is refused. GitHub Enterprise Server takes no such
    upload, and Bitbucket has no API for one: there the control isn't
    offered (`capabilities.pictures`).
  - **By hand, or by a project rule.** `postScreenshots`, "Post screenshots
    to pull requests automatically", off unless turned on, among the
    project's Tasks switches. Off, Outputs offers it quietly beside What it
    looks like: "Post to PR #142", then "Posted to PR #142", or "Update PR
    #142 · 2 changed" once it differs. It opens the screenshots, each to keep
    or leave out, with where they go. On, the line says "Synced to PR #142":
    what changes goes up as listening goes round, and turning it on posts
    what each open task shows now. A try that failed says so in the sheet,
    and is tried again by itself ten minutes later.
  - **What the person leaves out stays out,** of that pull request, by view,
    whoever posts after: a view left out for something on screen it
    shouldn't show is usually still that when it is taken again.
- **Alternatives considered:**
  - _A new comment each time:_ notifies everyone each time, and leaves the
    reader working out which is current.
  - _The pull request's description:_ people edit it; Althar would fight them
    for it.
  - _A bucket of Althar's own, or an evidence branch:_ a bucket's links are
    readable by anyone holding them, which a private repository's pictures
    mustn't be; a branch puts pictures in the repository. The hosts' own
    uploads keep the repository's access. A branch remains the way in for
    Bitbucket, later.
- **Trade-off:** GitHub's upload endpoint is the one its CLI uses, not one its
  REST documentation lists, so it may change; the adapter's tests hold what
  it sends and reads, and a change there fails as the host's own words.
  Uploads can't be taken back, so a screenshot posted stays reachable by its
  address, which the confirm step stands in front of.
- **Revisit when:** GitHub documents a REST upload, or offers one on
  Enterprise Server; Bitbucket gains one; or people want screenshots per
  repository in a task of several (today the first pull request whose host
  takes them gets the comment).

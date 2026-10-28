# ADR-041: What failed is said in full: a check run again once, its whole log on request, and the checks Althar can't see

- **Status:** Accepted
- **Date:** 2026-10-15
- **Amended:** 2026-10-18: a failed check's log is never left out
  silently. The failed-checks card shows the end of each one's log, or
  why Althar couldn't read it ("GitHub refused (403): …") with a link to
  the check's page; the lead is told the same, and whether
  `read_check_log` would fare any better. A check another CI service ran
  gives its page, and on GitHub what its check run reported. A host's
  `checkLog` fails with why where it keeps a log it won't give, rather
  than reading as none. Logs behind a redirect to storage elsewhere
  (GitHub Actions, Bitbucket Pipelines) are followed without Althar's
  token, which that storage refuses.
- **Owner:** Repository maintainers
- **Context:** Once a change's checks are Althar's to see through
  ([ADR-040](040-a-change-reaches-the-person-green.md)), its lead fixes
  them alone. What the lead knew of a failure was the end of two logs: 150
  lines or 12,000 characters, which miss a failure printed early, or one
  among many. A test that failed by chance cost a fix that changed nothing.
  And where Althar couldn't read the checks (a token without access, a host
  that refused), the whole of its listening stopped silently, comments
  included; checks that never finished kept a change Running for good.
- **Decision:**
  - **A check that failed is run again once before its lead is told,**
    while the change is in Althar's hands, where the host can
    (`CodeHost.rerun`: a GitHub Actions job, a GitLab job; not Bitbucket's
    whole pipelines). The thread says "Running test on PR #1 again, once,
    in case it failed by chance." If it passes, the lead never hears of it;
    if it fails again, the lead is told as before. A failure counts as the
    run again's only once the host has shown it running again, or three
    minutes after it was asked for: the old failure can still show a moment
    after. A commit that failed
    counts once toward the lead's fixes, however often it was run.
  - **The lead reads a check's whole log, a page at a time**
    (`read_check_log`, 300 lines): by the check's name, from a line, or its
    last page without one, told where the pages before and after start.
    Never more than a page in its context at once. The hosts' `checkLog`
    gives the whole log when asked (`whole`), not only its end. Not for a
    review of someone else's pull request: its lead reads what the host shows.
  - **Checks Althar can't read don't stop the rest:** a host's refusal of
    the checks is said in the thread once a commit ("Althar can't read the
    checks on PR #1: its host refused them (…)"), and what people say on the
    pull request, and its merge, are still heard. A change in Althar's hands
    is the person's then, since Althar can't see its checks through. GitHub
    is the exception: a token without access to check runs reads only the
    commit's statuses, with no refusal to hear, and Connect says so when the
    person connects (ADR-026); the pull request doesn't say it again.
  - **Checks that run too long make the change the person's:** past 45
    minutes (`STUCK_AFTER`) on one commit, while Althar sees them through, the
    thread says "The checks on PR #1 have run for 45 minutes, so the change
    is yours now", and it comes to the person.
- **Alternatives considered:**
  - **Give the lead every failing log whole, at once.** A long CI log is
    tens of thousands of lines, which would sit in the lead's context for
    every call after; a page on request costs only what it reads.
  - **Run a failed check again whatever whose hands it is in.** Once the
    person has the change, what runs on their pull request is theirs to
    start.
  - **CI's uploaded reports (artifacts).** Left for later: downloading and
    unpacking them safely is its own piece of work, and the whole log already
    holds most of what a report says.
- **Trade-off:** a failure that is real waits one more run before the lead
  is told. Forty-five minutes is a guess at what "too long" means: some
  suites take longer, and their changes come to the person before they end.
  The card on the board still says only what its checks counted; the
  thread says the rest.
- **Revisit when:** CI reports are wanted; or the card should say "can't
  read checks" or "checks running for 1h" on its own line.

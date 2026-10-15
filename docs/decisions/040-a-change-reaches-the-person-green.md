# ADR-040: Until the person has looked, a change's checks are Althar's to see through

- **Status:** Accepted
- **Date:** 2026-10-15
- **Owner:** Repository maintainers
- **Context:** A change came to the person (Needs you) as soon as its pull
  request opened, while its checks still ran, which on some projects takes
  25 minutes or more. A failure reached the lead only if its session was
  still running, and every fix waited for the person to press Push, on a
  change they hadn't looked at yet. So the person was handed work that was
  about to fail in CI, and then asked to push fixes for it one by one. The
  person agreed on 15 October that fixes push without asking until the
  change first reaches them.
- **Decision:**
  - **A change is in Althar's hands** (`Changes.handsOf`) when all of these
    hold, read from the record each time, with nothing stored to fall out of
    step:
    - its plan's run ended well, with a pull request that is open;
    - the person hasn't opened the task since, said anything on it, stopped
      or interrupted its lead, or pushed to it themselves;
    - its lead hasn't spent its fixes.
  - **While its checks run, it is under way, not the person's:** its card
    is Running, with the step "Checks running", and it holds no place among
    the agents at work, since nothing works on this machine meanwhile. A pull
    request that shows no checks yet counts as running for a minute after
    the work came back (`checksAppear`), while the host registers them,
    where the repository's pull requests have had checks before; in one that
    never has, it comes to the person at once. Once they pass, it comes to
    the person, in Needs you.
  - **A failure goes to its lead, which is started again if its session has
    ended**, on the agent it was last on. It is told the person hasn't seen
    the change, so its fix goes up as it makes it, and how many tries are
    left.
  - **The lead's fix goes up without asking:** `push_to_pull_request` pushes
    at once while the change is in Althar's hands, and the checks run again.
    If the push fails, the person is asked as before.
  - **Three fixes (`FIX_ROUNDS`), then the person.** If the checks still
    fail after the third, the thread says "The checks on PR #1 still fail
    after 3 fixes by its lead, so the change is yours now", the change comes
    to the person, and from there its fixes wait for their push, as before.
  - **Once the person has the change, nothing changes from before:** a
    failure reaches a running lead only, and every push is theirs.
  - What Althar writes to an agent quietly is now authored by Althar, not
    by the person whose command it came with, so the person's words are only
    what they said.
- **Alternatives considered:**
  - **Store when a change first reached the person.** One more record to
    keep in step; whether they have opened, spoken on, stopped or pushed it
    is already in the record.
  - **Fix forever until green.** A check that can't pass would burn turns
    unseen; three tries are enough for what a lead can fix.
  - **Re-run a failed check once before telling the lead,** for flaky tests.
    Left for later: no connector can re-run a check yet.
- **Trade-off:** a change can sit in Running for as long as its CI takes,
  which the person sees as under way rather than waiting for them; they can
  still open it, which makes it theirs. A minute is a guess at how long a
  host takes to show its checks.
- **Revisit when:** connectors can re-run a check, or read whole logs and CI
  reports, which would let the lead fix more on its own; or people want
  Althar to see the checks through after they have looked as well.

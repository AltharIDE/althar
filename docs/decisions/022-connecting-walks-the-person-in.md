# ADR-022: Connecting walks the person in, and says what the connection can do

- **Status:** Accepted
- **Date:** 2026-10-11
- **Owner:** Repository maintainers
- **Context:** Connecting a code host or tracker was a row with Sign in or
  Add a token, and a form of fields under it: where to make a token was a
  link to an empty page, nothing said which permissions it needed, and once
  a token was taken Althar knew only whose it was. A token without pull
  requests, or a fine-grained token, which GitHub gives no check runs,
  connected as if it could do everything, and the person found out when a
  task ended on its branch. Many people already have `gh` or `glab` signed
  in. None of Althar's own apps (GitHub's, GitLab's, Linear's) is
  registered yet, so their browser sign-ins work only where a build is
  given their ids.
- **Decision:**
  - **Connecting is a walk, one step at a time,** as a sign-in card:
    Settings narrows its panel to it, a task hosts it in a side panel, and
    a project's settings, its repositories and a new project in a dialog
    at the card's width, on the one host asked for. First the ways in that can work here, each saying what it
    needs from the person; then each step of the one chosen; then what the
    connection can do. A way that can't work in this build is never shown.
  - **The ways in:**
    - The service's own sign-in in the browser, where Althar's app is set
      up for it (ADR-011). GitHub's is its App, which is then installed on
      the projects' owner.
    - **gh's or glab's sign-in, copied.** Offered only where the tool is
      signed in to that instance on this device and its token answers. The
      runtime reads the token the way the tool hands it out (`gh auth
      token`, `glab config get token`) and keeps its own copy in Althar's
      keychain; agents never see it, and still run with gh and glab signed
      out. gh's token is a broad OAuth token, which an organisation that
      restricts OAuth apps keeps out; the check says so.
    - **A token, made on a page opened filled in** where the service takes
      it (GitHub's fine-grained token page: its name, description, owner,
      90 days and permissions; GitLab's: name, description and the `api`
      scope; a classic token on a company's own GitHub), with what to do on
      the page, and noticed on the clipboard as the window comes back.
      Pasting it is always offered too.
    - **A company's own server, by its address,** filled in from the
      projects' remotes, each asked, without signing in, which product
      answers there. A Jira site says whether it is Cloud or Data Center.
  - **The clipboard is read only while a step waits for a token, and only
    as the window comes back.** The main process hands the page only text
    that looks like a service's token (`github_pat_`, `ghp_`, `glpat-`,
    `ATATT`, `ATTA`, `lin_api_`); anything else the person copied never
    reaches it.
  - **Every connection is checked, by reads only:** who it signs in as,
    whether it reaches the projects' repositories on that instance, and
    each thing Althar does there, line by line, with the token's expiry
    where the service says it. What only a write would tell (what a
    fine-grained token or an API key may change) is said not to be known,
    never guessed. A line that can't be done says why and how to put it
    right on the service's own page, and the person can connect as it is.
  - **Signing in again keeps the connection's address, and the email or
    key that went with its token,** and takes a token only for the account
    it was.
- **Alternatives considered:**
  - Keep the token form, with better links: still nothing says what a
    token can do until a task fails.
  - Borrow gh's sign-in on each call, rather than copy it: agents would run
    beside a live sign-in Althar doesn't own, and a `gh auth logout` would
    stop tasks mid-way. ADR-011 already turned down gh as the connectors'
    layer; this takes only its token.
  - Probe what a token can write by sending requests that fail on purpose:
    some services act on them, and a check must never change anything.
  - A classic GitHub token by default, which reads check runs: broader
    than Althar needs, and every repository the person can see. The
    fine-grained token is the default; the check offers a classic one where
    check runs matter.
- **Trade-off:** each service's steps and words are Althar's to keep up
  with its pages; a filled-in page can drift when a service renames a
  parameter. Reading the clipboard is a trust the person gives the window,
  kept narrow. A copied gh token doesn't follow gh's: signing gh in again
  doesn't renew Althar's copy.
- **Revisit when:** Althar's apps are registered (the browser sign-ins
  become the first way everywhere); a service lets a token's permissions be
  read; or Althar has a cloud and Atlassian's OAuth.

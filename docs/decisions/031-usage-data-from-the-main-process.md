# ADR-031: Anonymous usage data goes from the main process, named events only

- **Status:** Accepted
- **Date:** 2026-10-12
- **Owner:** Repository maintainers
- **Context:** Feedback says what people think; it doesn't say how many who
  download Althar sign an agent in, make a project, start a task, see it
  settle and come back the next day (Linear DEV-76). Those are funnels and
  retention, and need numbers. Althar holds people's code, prompts and
  what agents write, and its window is locked down (07): a strict Content
  Security Policy, no network of its own. Whatever counts what people do
  must never carry any of that, and must be easy to see is so.
- **Decision:**
  - **PostHog's US cloud, from the main process, with posthog-node.**
    Funnels, retention and paths are built in, it is open source, and the
    first million events a month are free. The project is on the US cloud
    (`us.i.posthog.com`), where it was made; a project can't change region. Events go over Electron's own network
    (`net.fetch`), one request each; the window has no analytics SDK, so
    nothing is captured automatically, and its Content Security Policy is
    unchanged (`connect-src 'none'`).
  - **Named events only, each with named properties** (`main/usageData.ts`):
    Althar opened, the first screen done, an agent signed in, a project
    made, a task started and settled, an ask answered, a usage limit hit, an
    update installed. Each property is a count, a word from a short list, or
    an agent's or model family's id. The main process drops any other event
    or property, whoever said it, so the list there is what can ever leave.
    Every event carries the app's version, the system, the processor and a
    random id made for this install, kept in the profile's `desktop.json`;
    person profiles stay off (`$process_person_profile: false`) and GeoIP
    is never looked up.
  - **The runtime says what happened, from the record** (`UsageData`, in
    `@althar/runtime`). It reads `record_events` as the ledger grows, the
    way each fact was recorded, from where the record stood as the launch
    began; no workflow sends usage data itself. Sign-ins aren't recorded, so
    `SignIns` says when an agent is found signed in, once a launch, or signs
    in again. The utility process hands each event to the main process, as
    it does nudges.
  - **A switch the person sees before anything is sent.** "Usage data" is
    an app preference (`usageData`), on by default, shown under the
    repositories on the first screen with one line on what it sends and
    never sends, and in Settings' foot, with the whole list. The main
    process waits for the preferences to be read before the first event, and
    asks the switch as each event comes and again before each request goes,
    a try again included, so nothing leaves once it is off. On Althar's first
    launch, events wait until the window has shown the switch, then go if it
    is still on. `DO_NOT_TRACK` set where Althar started keeps it off, and
    the switch says so. A `desktop.json` that is there but can't be read
    keeps it off, and is written again so; the file is always written whole.
  - **Only a release sends.** PostHog's project key and host are given to a
    packaged build alone (`--mode package`), from the environment or
    `apps/desktop/.env`; the release workflow takes them from the
    repository's variables. Development builds, the end-to-end tests and
    anyone's fork send nothing.
- **Alternatives considered:**
  - **PostHog's browser SDK in the window** (`posthog-js`, as PostHog's
    setup wizard writes it). It captures clicks with their element text and
    each page's address by default, and PostHog's project settings can turn
    on session replay, exception capture and surveys without a release; its
    extensions load scripts from PostHog's servers, so the window's policy
    would have to allow scripts and connections to any HTTPS host. Names,
    titles and what people type are on that page.
  - **PostHog's EU cloud** (`eu.i.posthog.com`), which the ticket leaned to.
    The project was already made on the US one, and nothing Althar sends
    names anyone.
  - **Aptabase.** Built for desktop apps, with no device ids, and open
    source; 20,000 free events a month, and thinner funnels and retention.
  - **Events sent where each happens** (in `Tasks`, `Runs`, `Projects`).
    Usage data would be scattered through the workflows, and each new path
    to the same outcome would need its own call; the record already says
    each outcome once.
  - **Opt-in.** The stricter choice. The events are anonymous and say
    nothing anyone wrote, and the switch is on the first screen with what it
    sends, so it starts on.
- **Trade-off:**
  - **A task's outcome is read after the fact**, half a second after it is
    recorded; an event in flight as Althar quits gets two seconds. What was
    recorded in the half second before Althar quits, or before the runtime
    crashes and starts again, is never said: draining the record through
    shutdown, and keeping where it was read across a restart, cost more
    than an event now and then.
  - **A task settles once**, the first way it does (merged here, its first
    pull request, or abandoned), until it is reopened; one abandoned after
    its pull request opened isn't said again.
  - **The switch is seen on the first screen only by a new install.** No
    one had Althar with a project when this shipped; one that has a project
    finds the switch in Settings.
  - **An agent signed in is said once a launch it is found signed in**,
    and again only when an account signs in after being signed out.
  - **The request still reaches PostHog from the person's address.** GeoIP
    is off per event; discarding addresses is a setting of the PostHog
    project, which should be on.
- **Revisit when:**
  - Crash and error reports come (DEV-66): a second switch beside this one,
    with its own consent.
  - Report a problem (DEV-61) lands: it adds `problem_reported` to the list.
  - A question needs a property that could name something: it doesn't go;
    the question changes.

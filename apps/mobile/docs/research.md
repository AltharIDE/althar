# Phone apps for agent orchestration tools: what ships, what works

Researched 2026-10-21. Many vendor sites couldn't be fetched from this sandbox, so a lot of facts come from search-engine summaries of those pages. **(unverified)** marks a single third-party source. Where I found nothing, I say so. No screens are invented.

## 1. Products

### Orca (stablyai/orca, onorca.dev): open-source worktree app with an Expo companion
- The README says "Monitor and steer your agents from your phone", including a notification when an agent finishes. A relay lives in `cloud/`. https://github.com/stablyai/orca
- The docs call it "mostly read-only": you can reply to prompts and sleep worktrees. Pairing is one-time and "desktop is always the source of truth". You can edit a host's address (LAN or Tailscale) without re-pairing. https://www.onorca.dev/docs/mobile (via search)
- The pairing QR encodes the endpoint, a device token and a TLS fingerprint (WebSocket RPC on :6768). A `ProtocolBlockScreen` appears when versions are incompatible. https://github.com/stablyai/orca/tree/main/mobile
- Routes: hosts list, `pair-scan`, `pair-confirm`, `notification-opt-in`, `connection-log`, `troubleshoot`, `voice-settings`, `h/[hostId]`. https://github.com/stablyai/orca/tree/main/mobile/app
- **Stack:** Expo 55 and React Native 0.83. The terminal is xterm.js in a WebView. Also tweetnacl, secure-store, a custom two-way-audio module and a mermaid renderer. https://raw.githubusercontent.com/stablyai/orca/main/mobile/package.json
- The listing says it "live-mirrors desktop terminals" and notifies you "when a TUI goes idle". Copies of the listing say same-Wi‑Fi only **(conflicts with the relay)**. There are about 6 ratings. https://apps.apple.com/us/app/orca-ide/id6766130217

### Cursor: native iOS app (public beta since 2026‑06‑29), earlier PWA
- Starts cloud agents and remote-controls local agents. To pair, tap your computer in the app, then approve on the desktop. A desktop toggle, "Keep this computer awake", keeps the host reachable. https://cursor.com/changelog/remote-control-local-agents
- **Live Activities** on the lock screen and Dynamic Island show up to 8 agents. Pushes fire when an agent "finishes, needs input, or is ready for review". https://cursor.com/help/ai-features/mobile-app
- You can review demos, screenshots, logs and diffs, send follow-ups, and merge the PR. https://cursor.com/blog/ios-mobile-app
- The listing also mentions a "diff view designed for mobile", annotating screenshots as feedback, and voice. https://gigazine.net/gsc_news/en/20260630-cursor-for-ios
- Dictation uses live transcription. A TTS conversation mode isn't built yet. https://cursor.com/docs/cloud-agent/mobile ; https://forum.cursor.com/t/cursor-app-with-voice-chat-function/164244
- Requires iOS 26. iPad runs in compatibility mode and Android is "planned". Stack not found.
- **Praise:** Live Activities, notifications, and Remote Control "makes the app actually usable". https://x.com/NickADobos/status/2071677855025762754 (via search)
- **Complaints:**
  - You can't start a new *local* agent from the phone. https://forum.cursor.com/t/remote-control-feedback-and-suggestions/164621
  - A workspace appears only if Remote Control is on, the workspace is open, and it's a git repo. https://forum.cursor.com/t/cursor-mobile-and-remote-control-hard-to-use/171650
  - Silent handoff failures. https://forum.cursor.com/tag/remote-control/407
- **The earlier PWA** (cursor.com/agents) offered Add to Home Screen, a push when an agent completes, and offline viewing of past runs. You can also start agents with @Cursor in Slack. https://docs.cursor.com/background-agent/web-and-mobile

### Superset (superset.sh): Electron worktree app with an Expo companion (Product Hunt 2026‑09‑21)
This is the closest analogue to Althar, and its mobile code and design plans are public.
- The phone starts agents on a connected machine or cloud workspace, follows terminal output, and sends follow-ups by text, dictation or photo. It shows PR status and file-by-file diffs. Same-account sign-in lists your machines. https://toolradar.com/tools/superset-mobile **(third-party)**
- **Stack:** Expo 57 and React Native 0.86, with Shiki diff highlighting and xterm. A **Live Activity target** is built with `@bacons/apple-targets`. There are `apps/relay` and `apps/realtime` folders. https://raw.githubusercontent.com/superset-sh/superset/main/apps/mobile/package.json ; https://github.com/superset-sh/superset/tree/main/apps
- **Home plan:** https://raw.githubusercontent.com/superset-sh/superset/main/apps/mobile/plans/20260709-1438-unified-home-workspaces-sessions.md
  - Workspaces and sessions merged into one grouped list, so a session is one tap away. "Accordions reintroduce the extra tap this change exists to remove."
  - Date-group headers. The row subtitle is `branch · +LOC −LOC`.
  - Amber dot means working, red means needs input. One host-wide poll replaces per-workspace polls.
  - Terminal rows were dropped from mobile.
  - Bug they hit: dots froze on the last state after a disconnect.
- **Voice plan:** https://raw.githubusercontent.com/superset-sh/superset/main/apps/mobile/plans/20260711-composer-voice-states.md
  - Voice is an input method that appends to the draft.
  - The recording pill copies iOS's own.
  - "Transcribe at the end, never during", so thinking pauses don't cut off.
  - Native Apple speech recognition beat gpt‑4o‑transcribe on device.
  - The draft is cleared only after a successful send.
- **Live Activity:** https://raw.githubusercontent.com/superset-sh/superset/main/apps/mobile/targets/agentactivity/AgentActivityWidget.swift
  - One per machine.
  - Rows ranked by priority: `permission` (amber), `failed` (red), `review` (green), working (grey). Each row shows elapsed time and deep-links to its agent.
  - The island shows the agent count.
  - Rows from hosts that stopped reporting are dimmed, and the card says "Not updating" when stale.
  - No buttons.
- **Host states** are tested: never-connected ("Waiting for it to connect…"), online, and offline ("is offline", "Last seen", "Try again"). https://github.com/superset-sh/superset/tree/main/apps/mobile/.maestro/flows/host-states
- The phone answers tool approvals, questions and plan approvals over the relay. The host is authoritative, so there's no offline history. Send failures are silent (a known gap). https://raw.githubusercontent.com/superset-sh/superset/main/apps/mobile/plans/mobile-chat-runtime.md

### Happy / "Happy Coder" (slopus/happy): open source, end-to-end encrypted
- **Components:** an Expo app (iOS, Android, web), a CLI wrapper (run `happy` instead of `claude`/`codex`), and `happy-server`, the "relay server for encrypted sync". https://github.com/slopus/happy
- **Pairing and switching:** pair by scanning the QR shown by the CLI. Taking control from the phone restarts the session in "remote mode", and a keypress takes it back on the desktop. https://www.mintlify.com/slopus/happy/quickstart (via search)
- **Push** fires for permission requests and completion, and deep-links into the session. https://apps.apple.com/app/id6748571505
- **Stack:** Expo 55 and React Native 0.83. Crypto is libsodium. Voice uses LiveKit and ElevenLabs. It includes `expo-local-authentication`. **No Live Activity.** https://raw.githubusercontent.com/slopus/happy/main/packages/happy-app/package.json
- **Voice:** a realtime voice agent, labeled experimental. Paid voice is the planned business model. https://hn.svelte.dev/item/44904039
- **Complaints (top issues):** https://github.com/slopus/happy/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc
  - Hosted relay outages (#323, #418, #1866).
  - Questions shown as permission prompts (#375).
  - Can't grant Codex permissions (#661).
  - Switching back to local loses history (#527).
- **Push silently dropped:** the server counted a CLI socket as "user active". https://github.com/slopus/happy/issues/1383

### Claude Code on mobile (Claude app → Code tab: Remote Control, cloud sessions, Dispatch, Projects)
- One Code tab. "Projects" lets you "see which threads finished or need you". You can't choose Bypass permissions from the phone. https://code.claude.com/docs/en/mobile
- **Remote Control:** https://code.claude.com/docs/en/remote-control
  - **Pairing and transport:** QR (spacebar in the CLI) or the session list, where a computer icon has a green dot when online. TLS through Anthropic's API, not end-to-end encrypted. Reconnects when the laptop wakes.
  - **Prompts:** permission prompts and questions wait for an answer; other dialogs expire after 5 minutes.
  - **Push:** two toggles, "Push when actions required" and "Push when Claude decides". **Pushes are skipped while you're typing in the terminal.**
- **Actionable Approve/Deny on the push was requested and closed "not planned".** Users build ntfy or Telegram hooks instead. https://github.com/anthropics/claude-code/issues/62458
- **Complaints:** sessions drop on Wi‑Fi↔5G switches, Stop doesn't interrupt, the phone shows a prompt already answered on the desktop, and prompts sometimes never reach the phone. https://news.ycombinator.com/item?id=47148454 ; https://docs.bswen.com/blog/2026-03-17-claude-code-remote-disconnect-fix/

### OpenAI Codex in the ChatGPT app (preview 2026‑05‑14, GA around late June)
- Same laptop-host model as Althar. You scan a QR from the Codex desktop app; the host must stay awake, online and signed in. There's a "Keep this Mac awake" setting. https://developers.openai.com/codex/remote-connections (via search)
- Credentials and files stay on the host. The phone gets screenshots, terminal output, diffs and approvals, and can start tasks and switch models. https://ianslive.in/openai-launches-codex-in-chatgpt-mobile-app-for-ios-android--20260515121945
- An end-to-end encrypted Noise relay, one-to-one pairing, and revoking a device means a fresh QR. https://codex.danielvaughan.com/2026/07/28/codex-remote-ga-noise-encrypted-relay-qr-pairing-mobile-agent-control-headless-ci-cd/ **(unverified)**
- Inline review comments on changed files, plus branch and worktree selection. https://codex.danielvaughan.com/2026/06/12/codex-mobile-chatgpt-ios-branch-worktree-goal-inline-review-cli-companion/ **(unverified)**
- **Widgets:** a Tasks widget lists tasks across hosts (spinner for running, "?" for waiting), and a usage widget. Notifications open the task. https://www.ithinkdiff.com/?p=348832 ; https://releases.sh/release/rel_Fz0abPYO0oVtr94_1v4YO-ios-notifications-now-open-completed-tasks-directly
- **Complaints:**
  - Approvals were easy to miss: the button was "small and low on the screen", with no push. https://community.openai.com/t/codex-approval-requests-should-trigger-mobile-push-notifications/1381134
  - "The Approval Button Is the Trap": a small screen invites rubber-stamping. https://gptcodex.substack.com/p/your-phone-is-not-a-codex-ide-its

### GitHub Mobile (Copilot cloud agent)
- To start a session: New Session, then repo, prompt, branch and model. https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-mobile
- A Copilot tab lists sessions, filterable by state and updating live. You get native session logs, can stop a session, and can create and review the PR. You iterate by commenting @copilot on the PR. https://github.blog/changelog/2026-04-01-github-mobile-stay-in-flow-with-a-refreshed-copilot-tab-and-native-session-logs

### Others
- **Conductor:** the iPhone app (2026‑09‑14) only controls *cloud* workspaces: check agents, read code, see PR status, merge. No local remote control, and no push details found. https://runtimewire.com/article/conductor-iphone-app-cloud-coding-agents
- **Omnara (YC S25):** runs sessions on your own machine and shows them in web and mobile apps. It offers push "when agents need you", "one-tap approvals", diffs, localhost previews and two-way voice. Rated 4.3 from 18 ratings; last updated 2026‑03. https://www.producthunt.com/products/omnara ; https://apps.apple.com/app/id6748426727
- **AgentsRoom:** https://agentsroom.dev/docs/live-activities
  - One Live Activity for all agents across all computers, also on Apple Watch and StandBy.
  - A waiting agent's question comes first and the island turns red.
  - A summary card stays for 20 minutes, and the activity ends after 15 minutes with no computer reporting.
  - Android uses an ongoing notification.
- **Remi:** shipped lock-screen and Watch answers. https://github.com/yooz-labs/remi/issues/298
  - Notification categories: Yes/Always/No, Yes/No, and up to 4 options.
  - Every action requires authentication.
  - A local "not delivered" notification fires if the send fails within about 10s.
- **claude-remote-approver:** Approve / Always Approve / Deny. On timeout it falls back to the terminal prompt instead of auto-approving. https://github.com/yuuichieguchi/claude-remote-approver
- **Difftray:** mark each file reviewed and leave line comments, which are exported as a prompt for the agent. https://apps.apple.com/ca/app/difftray-code-review-diff/id6789255782
- **Devin Mobile:** a beta waitlist with a recent-sessions list and a prompt box **(unverified)**. https://alphasignal.ai/news/cognition-brings-devin-mobile-to-iphone-so-developers-code-on-the-go
- **Vibe Kanban:** a pairing code lists the host's workspaces on the phone. https://vibekanban.com/docs/remote-access
- **No phone app found:** Jules (web only in the sources), Warp/Oz ("mobile" mentioned but unconfirmed, https://www.warp.dev/oz), Factory (a third-party claim only), and Terragon (nothing found).

## 2. Patterns that work

1. **The phone is a remote control; the computer stays canonical.** Orca, Codex, Claude Remote Control, Cursor and Superset all mirror host state and run nothing on the phone.
2. **Four attention states drive everything:** needs-you (permission or question), failed, ready for review, and working. Superset, Cursor and AgentsRoom use this, with red or amber for needs-you and green for review.
3. **Live Activity as a fleet monitor ranked by urgency.** Cursor shows up to 8 agents. Superset shows one per machine and dims stale rows. AgentsRoom puts the question first with a red island. Users praise it.
4. **Push for three events only:** finished, needs input, and ready for review. Cursor, Codex, Happy, Omnara and Claude do this. Claude splits it into two toggles.
5. **Presence-aware suppression:** don't push while the person is at the laptop (Claude).
6. **Actionable approvals from the lock screen and Watch.** Users demand this (the Claude issue, ntfy hacks), and Remi shipped it: Approve / Always / Deny behind authentication, with a fallback on timeout.
7. **QR pairing, confirmed on the host, with revocation on the host.** Codex, Cursor, Orca (the QR carries a fingerprint) and Happy.
8. **A "Keep this computer awake" setting.** Cursor and Codex both added it, because sleep is the top failure.
9. **Explicit host states** with last-seen and retry (Superset), or a green online dot (Claude).
10. **One tap from home to a session** (Superset), and filtering by state (GitHub).
11. **Voice as dictation into the composer** (Cursor, Superset). Full voice agents are a niche or paid feature (Happy, Omnara).
12. **Show results, not just diffs:** screenshots, demos and annotations (Cursor), and previews (Omnara).
13. **Mobile review means a file list, a per-file diff, and "send feedback to agent".** Superset, Cursor, Codex inline comments, Difftray and GitHub @copilot.

## 3. Anti-patterns and complaints

- **Approvals that never reach the phone.** Codex, Happy #1383 (a presence check suppressed the push) and early Claude Remote Control reports. When presence is unsure, send the push.
- **Stale state:** a prompt already answered elsewhere (Claude), and dots frozen after a disconnect (Superset).
- **Approve buttons without context, or small and low on the screen:** rubber-stamping and missed approvals (Codex).
- **Hidden prerequisites, and no way to start local work from the phone** (Cursor).
- **A single hosted relay as a point of failure** (Happy outages).
- **Fragile connections:** network switches drop sessions, Stop doesn't stop (Claude), and sends fail silently (Superset, Cursor).
- **Prompt types rendered wrongly:** a question shown as a permission prompt (Happy #375).
- **Losing a dictated prompt when the send fails** (Superset fixed this).
- **A raw terminal mirror as the main UI** (Orca). Superset dropped it.
- **iOS Live Activity gotcha:** a remotely started activity shows an Allow prompt and gets no push token until accepted, so start it in the foreground first. https://developer.apple.com/forums/thread/800669

## 4. Recommendations for Althar's phone app (ranked by value)

1. **"Needs you" inbox as the home tab.**
   - **Order:** permission requests and questions first, then failed or stuck tasks, then draft PRs ready for review.
   - **Card contents:** each card stands alone, with project › task, the agent (lead or reviewer), the exact command, path or hunk, and the agent's reason. Questions show their options as buttons plus a text reply.
   - **Approval actions:** Allow once / Allow for this task / Deny, behind Face ID with the paired key. Big buttons within thumb reach.
   - **Resolved cards** disappear live and their notifications are withdrawn.
2. **Actionable, end-to-end encrypted notifications.**
   - **Categories:**
     - `PERMISSION`: Allow / Deny / Open.
     - `QUESTION`: up to 3 options plus a text reply.
     - `REVIEW_READY`.
     - `FAILED_OR_STUCK`.
     - `LAPTOP_OFFLINE_WITH_PENDING`: the relay can send this from heartbeat metadata alone.
   - **Delivery:** a Notification Service Extension decrypts payloads, so the relay sees only ciphertext. Mark needs-you pushes Time Sensitive and thread them by task.
   - **Asymmetry:**
     - **Deny** runs in the background.
     - **Allow** needs the biometric key, which may require bringing the app to the foreground for a Face ID sheet. *Verify whether a biometric-protected Keychain key can sign from a background notification action.*
   - **On send failure**, post a local notification that the answer wasn't delivered.
   - Apple Watch gets the buttons for free.
3. **Laptop presence everywhere.**
   - **States:** never paired, online, asleep with last-seen, and offline with retry.
   - **Banner:** "MacBook asleep since 14:02 · 2 requests waiting", with answer buttons disabled and a reason shown.
   - **Desktop setting:** "Keep awake while agents run or requests are pending".
   - **Push suppression:** only on a positive at-keyboard signal, never on socket presence alone.
4. **Projects → tasks tab.** Grouped by project. Each row shows a dot (red: needs you, amber: working, green: draft PR ready), the lead and reviewer icons, the branch and ±LOC, and elapsed time. One tap opens the task.
5. **Task detail.**
   - **Activity:** a condensed timeline, not a terminal.
   - **Changes:** a file list, then a per-file diff with mark-viewed and a line-comment action, "comment to the lead agent".
   - **Review:** the reviewer agent's findings, each with "send to lead".
   - **PR:** checks, "Mark ready for review", and open in GitHub.
   - **Composer:** dictation, and the draft clears only after a successful send. A Stop button confirms it reached the laptop.
6. **Live Activity, one per laptop.** Rows ranked needs-you > failed > review > working, deep-linked to their tasks, with stale dimming. *Constraint:* ActivityKit pushes can't be decrypted on the device, so keep the content non-identifying (counts and states), or accept that the relay sees coarse state. Decide this before building.
7. **Start a task from the phone, voice first.** Pick the project, dictate the prompt with native speech recognition, use the default lead and reviewer agents, and optionally attach a photo. This answers Cursor's top complaint.
8. **Pairing and devices.**
   - **Pairing:** the desktop QR carries the public key and relay address. The phone shows a fingerprint and enrolls the biometric key, and the desktop approves.
   - **Devices:** the desktop lists devices with last-seen and Revoke.
   - **Diagnostics:** a version-handshake screen, a connection log and a troubleshoot page (as Orca has).
9. **Notification settings by category:** "Needs me" and "FYI", plus quiet hours. Don't offer per-event micromanagement.
10. **Later:** a widget showing the needs-you count and running tasks (like Codex), and screenshot annotation (like Cursor). Skip a realtime voice agent and a terminal mirror in v1.

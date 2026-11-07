<p>
  <a href="https://althar.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="brand/export/banner/readme-header-ink.png" />
      <img src="brand/export/banner/readme-header.png" width="100%" alt="Althar. Building software has never felt so fast. Open source, with the agents you already pay for." />
    </picture>
  </a>
</p>

<p align="center">
  Althar is an open-source IDE for building with AI agents.<br />
  It runs the ones you already pay for, and keeps going whatever the labs change.
</p>

<p align="center">
  <a href="https://github.com/AltharIDE/althar/releases/latest"><b>Download</b></a> ·
  <a href="https://althar.ai"><b>Website</b></a> ·
  <a href="#bring-the-agents-you-already-pay-for"><b>Get started</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contributing</b></a>
</p>

<p align="center">
  Free and open source · Apache 2.0 · macOS, Windows and Linux
</p>

<br />

<img src="brand/export/screenshots/framed/project-home.jpg" width="100%" alt="A project's home: you ask for a backfill and the coordinator answers with a plan, Opus 5 implementing and Codex dry-running and reviewing, starting in 23 seconds. Beside it, the board: three tasks up next, three running, one question that needs you." />

<br />

<sub><b>01</b> · No new bill</sub>

## No new account. No new bill.

Althar uses the sign-ins already on your machine: your Claude plan, your ChatGPT plan, your keys. No token reselling, no proxy, nothing of ours between you and the model.

<table>
  <tr>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/claude-code-dark.svg" />
        <img src=".github/readme/agents/claude-code.svg" width="48" alt="" />
      </picture><br />
      <b>Claude Code</b><br />
      Claude Pro or Max, or an API key
    </td>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/codex-dark.svg" />
        <img src=".github/readme/agents/codex.svg" width="48" alt="" />
      </picture><br />
      <b>Codex</b><br />
      ChatGPT Plus, Pro or Business, or an API key
    </td>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/copilot-dark.svg" />
        <img src=".github/readme/agents/copilot.svg" width="48" alt="" />
      </picture><br />
      <b>GitHub Copilot</b><br />
      Copilot Pro, Pro+, Business or Enterprise
    </td>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/opencode-dark.svg" />
        <img src=".github/readme/agents/opencode.svg" width="48" alt="" />
      </picture><br />
      <b>OpenCode</b><br />
      Any API key, or a local model
    </td>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/junie-dark.svg" />
        <img src=".github/readme/agents/junie.svg" width="48" alt="" />
      </picture><br />
      <b>Junie</b><br />
      JetBrains AI Pro or Ultimate, or a Junie key
    </td>
  </tr>
  <tr>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/grok-dark.svg" />
        <img src=".github/readme/agents/grok.svg" width="48" alt="" />
      </picture><br />
      <b>Grok Build</b><br />
      SuperGrok or X Premium+, or an xAI key
    </td>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/kimi-dark.svg" />
        <img src=".github/readme/agents/kimi.svg" width="48" alt="" />
      </picture><br />
      <b>Kimi Code</b><br />
      A Kimi Code membership
    </td>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/mistral-vibe-dark.svg" />
        <img src=".github/readme/agents/mistral-vibe.svg" width="48" alt="" />
      </picture><br />
      <b>Mistral Vibe</b><br />
      Le Chat Pro or Team, or a Mistral key
    </td>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/qwen-code-dark.svg" />
        <img src=".github/readme/agents/qwen-code.svg" width="48" alt="" />
      </picture><br />
      <b>Qwen Code</b><br />
      Alibaba Cloud Coding Plan, or any API key
    </td>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/antigravity-dark.svg" />
        <img src=".github/readme/agents/antigravity.svg" width="48" alt="" />
      </picture><br />
      <b>Google Antigravity</b><br />
      A Google account, signed in inside Althar
    </td>
  </tr>
  <tr>
    <td width="20%" align="center" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset=".github/readme/agents/on-the-way-dark.svg" />
        <img src=".github/readme/agents/on-the-way.svg" width="72" alt="Cursor and Gemini CLI" />
      </picture><br />
      <b>More on the way</b><br />
      Any agent that speaks the <a href="https://agentclientprotocol.com">Agent Client Protocol</a> and can be held to asking can join (<a href="docs/decisions/050-an-agent-joins-where-althar-can-hold-it-to-asking.md">which, and why</a>)
    </td>
  </tr>
</table>

Agents join through the Agent Client Protocol, so a new one takes an adapter, not a rewrite.

<br />

<sub><b>02</b> · Why more than one</sub>

## The best coding agent right now is…

Claude Code. Codex. Gemini. An open model. Something new.

Ask again next month. New models ship most weeks, the best one for code keeps changing, open models keep closing the gap, and prices and limits move with all of it. The safe bet is not to bet on one.

- **Switch agents mid‑task.** Claude runs out halfway? Codex picks up the same thread, the same plan and the same branch.
- **Every plan, all at once.** Work goes to whichever agent has room left today. No more waiting for a reset.
- **Open source.** Nothing to get locked into. Read every line, fork it, run it. If we disappear, your setup doesn't.

**Subscriptions come and go. Your projects stay.**

<br />

<sub><b>03</b> · The coordinator</sub>

## Tell it what. It picks the team.

Every project has a manager. Say what you want done; it turns that into tasks and proposes who does each step. Leave it alone and it starts.

<table>
  <tr>
    <td width="44%" valign="top">
      <p><b>Knows your projects.</b> It reads the repos and your rules before it plans. You don't explain twice.</p>
      <p><b>Runs several at once.</b> Ask for three things, get three tasks going side by side.</p>
      <p><b>Builds the team.</b> A lead to implement, other models to review and audit. Swap anyone before it starts.</p>
    </td>
    <td width="56%" valign="top">
      <img src="brand/export/screenshots/framed/plan.jpg" width="100%" alt="You ask for a backfill; the coordinator answers with one task: Opus 5 implements, Codex reviews, then a draft pull request. It starts in 29 seconds unless changed or held." />
    </td>
  </tr>
</table>

<br />

<sub><b>04</b> · Every task</sub>

## Implement. Review. Fix. Review again.

Tasks don't stop at a first draft. Other models review the lead's work, the lead fixes what they find, and it goes round until the review is clean. Your rules add steps, like a security review when money is touched. You only step in to merge.

No more meat proxying: no more pasting one agent's answer into another.

<img src="brand/export/screenshots/framed/review.jpg" width="100%" alt="A settled review by Sonnet 5 and Gemini 3 Pro: three findings, two fixed by the lead in round 2 and one set aside with its reason." />

<br />

## Fall in love with building again.

Tired of juggling terminals, re-explaining your project and babysitting agents? So were we.

- **Every plan you have. One agent.** Sign Claude Code, Codex or OpenCode in once for each plan you pay for. When one runs out, Althar goes on with the next, in the order you set.
- **It keeps going while you're away.** Usage limits, stalled turns, review rounds: it handles them and carries on. You only hear what needs you.
- **Ten at once. None in each other's way.** Run as many tasks as you like side by side. Each gets a worktree of its own, so no two agents ever work in the same files.
- **Conflicts, settled.** Each lead settles its own conflicts with the default branch; only the odd one needs you.
- **Work that starts itself.** Ask once, for a time or for when something happens. It runs on your computer while Althar is open, and not until you turn it on.
- **Every workspace, side by side.** Day job on Linear, a client on Jira, side projects on GitHub? Plug them all in, and every issue lands in the right project. Pull requests go out to GitHub, GitLab or Bitbucket.
- **One home for everything.** What needs you, across every project, in one place, answered where it is. And what happened since you looked.
- **Your computer, your data.** Projects, threads and history live in a local database on your machine. No Althar account, no Althar cloud.

<table>
  <tr>
    <td width="44%" valign="top">
      <h3>Wherever you are, still in reach.</h3>
      <p>On a Mac, Althar sits round the notch or in the menu bar; on Windows and Linux, in the tray. Point at it to answer a permission or open a pull request, and carry on.</p>
    </td>
    <td width="56%" valign="top">
      <img src="brand/export/reels/island.gif" width="100%" alt="The island round the notch: two calls wait, and pointing at it drops it open to answer them." />
    </td>
  </tr>
</table>

**The craft of a paid app. The freedom of open source.**

<br />

<sub><b>05</b> · Get Althar</sub>

## Bring the agents you already pay for.

> [!NOTE]
> **Early.** Althar runs on macOS, Windows and Linux, and is tested most on macOS. Things will change, and some will break. [Tell us when they do](https://github.com/AltharIDE/althar/issues), or, in the app, Report a problem (in Help on a Mac, or at the foot of the quick settings), which sends what happened with the app's logs, paths and repository names hidden. Crash reports go on their own, masked the same way and never with your code, until you turn them off on the first screen or in Settings.

Install it with Homebrew, or [download it](https://github.com/AltharIDE/althar/releases/latest) for your system:

```bash
brew install --cask altharide/tap/althar
```

Open it. The first screen finds the agents on your computer and shows which are signed in; then you pick the repositories your first project works in.

<img src="brand/export/screenshots/framed/first-run.jpg" width="100%" alt="The first screen: Your agents. Claude Code is signed in, Codex is signed out with a Sign in button, and Gemini CLI isn't on this computer." />

Claude Code, Codex and Google Antigravity sign in from inside Althar. The others sign in with their own tools:

```bash
opencode auth login
```

And `copilot login`, `junie`, `grok login`, `kimi login`, `vibe --setup`, and `qwen` then `/auth`.

To build it from source instead, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Learn more

| | |
| --- | --- |
| [Development](DEVELOPMENT.md) | Set up, run, test and change the code |
| [Engineering standards](ARCHITECTURE.md) | What every app and package in the repository holds to |
| [Architecture](docs/architecture/README.md) | How Althar is built: a local-first desktop app, with seams for a later cloud |
| [Decisions](docs/decisions) | What has been decided, and why |
| [Open questions](docs/open-questions.md) | What hasn't been decided yet |
| [Glossary](docs/glossary.md) | The words the interface uses: project, coordinator, task, lead, step |
| [Thesis](THESIS.md) | What happens to software engineering once coding agents are abundant |
| [Components](packages/ui) | The interface, piece by piece, with every state as a story |
| [Brand](brand) | The mark, lockups, banners, screenshots and the characters |

## Contributing

The most useful thing you can do right now is use Althar on real work and tell us what breaks, in [an issue](https://github.com/AltharIDE/althar/issues). To change the code, start with [CONTRIBUTING.md](CONTRIBUTING.md). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## Licence

Althar is open source under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

Claude, ChatGPT, Codex, Gemini, Google, Antigravity, OpenCode, GitHub, Copilot, JetBrains, Junie, Grok, Kimi, Mistral, Qwen, Cursor, GitLab, Bitbucket, Linear, Jira and Trello are trademarks of their owners. Althar isn't affiliated with or endorsed by them.

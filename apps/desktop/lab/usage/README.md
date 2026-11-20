# The usage lab

Four directions for a Usage view of a project, after T3 Code's Usage page, built on what only Althar knows: tasks and their steps, the leads and reviewers behind them, what reviews found, merges, the plans' limits, what each task cost. The whole desktop app runs in the browser on made-up data with no runtime. Three seams in `vite.config.ts` add a fifth view to a project's header, **Usage**, after Artifacts, and each direction draws its page (`page.tsx`, `directions/`).

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/usage/vite.config.ts
```

At `http://localhost:6188`. The bar along the bottom, or its keys, swaps in place: **A**–**D** the directions, **T** dark, **N** the app's narrowest window (880 px). The page's own controls choose the period (7, 30, 90 days) and the scope (the project, or all projects), and stay as the directions change. Meridian's tab has its own, smaller numbers. The address keeps it all: `?d=c&theme=dark&range=90&all=1`.

## The data

`merges.ts` is every pull request merged on main since the repository began: 777 of them, with real titles, times and sizes (`git log --first-parent main --shortstat`). Each is a finished change. Around them, `facts.ts` makes up the rest from a seed: prototypes, chats, PR reviews, abandoned changes, meridian's work and the coordinator's day. It also makes up each task's lead and reviewer, its steps and their tokens, what each review found and what became of it, and the plans' weeks. They follow the project's notes: Opus 5.5 leads most work, Sol and Terra review, design moved to Claude on 31 Oct, and Fable 5.2 ran for a fortnight until the person stopped it on 13 Nov. Prices are made up. `measures.ts` is what each direction reads, as a runtime read would answer it.

What the runtime already keeps, which every direction draws on:

- each turn's tokens (input, output, thinking, read from and written to the cache), model and effort (`turn_deliveries.usage`), and the step it ran in (`node_attempt_id`)
- what an agent said a session cost (`provider_sessions.reported_cost`), with list prices for the rest (`ModelFacts`, `Spending.ts`)
- a task's share of each plan's week (`spendingOf`, from `plan_usage_weeks`), shown today in Outputs' Usage
- findings, with their severity, what became of them, and which review raised them (`findings`)
- tasks' start and end (`tasks.created_at`, `settled_at`), pull request states, limit asks (`attention_requests` of kind `usage_limit`)

## The directions

### A · Receipts

**What it's for:** what each piece of work cost, rather than what each day did. Every task in the period is a dot on one scale of dollars, with a row for each kind of work, so cheap small changes, costly prototypes and the odd $500 change stand apart at once. Under it is a receipt for each task: its steps, who ran them, their time, tokens and cost, what its reviews found, and its share of each plan's week. Pressing a dot opens its receipt. The coordinator's day is the one line that isn't a task.

**Cost to build:** medium. Most of it is one period-wide read: `spendingOf` already prices a task, and grouping its turns by node attempt gives its steps. The page uses the kit's parts plus one dot chart.

**Missing:** when a change merged. Nothing keeps `merged_at`: a pull request's state flips to merged, and `updated_at` only approximates it. "To merge" also needs its split (agents, checks, waiting on you), and that isn't kept either. ModelFacts has no price for writing to the cache, so cache writes are priced at the input rate.

### B · The team

**What it's for:** which models do the work well, for what they cost. For each lead: how much it led, what a merged change cost, how long it took to merge, how much its first review found, and how often it took another round. For each reviewer: how much it found and what became of it (fixed, set aside, dismissed). Then who reviews whom, and who led day by day. A few lines worth knowing come first: Fable at 3.7× Opus's cost per change, and Terra’s findings dismissed nearly three times as often as Sol’s. It turns the person's notes about models into numbers.

**Cost to build:** medium to large. The read groups sessions by role (lead, reviewer, helper, coordinator) through their steps, and findings by the session that raised them. Small samples need care so the numbers are fair, for example greying out what fewer than five reviews say.

**Missing:** merge times (as for A). The preset a task was planned from isn't kept on the task, only its parts. And "fixed" is a stand-in for "the finding was right": nothing records whether a dismissed finding was wrong or ignored.

### C · Plans

**What it's for:** usage against the limits the person actually pays for, rather than dollars nobody paid. Each plan's week fills against an even pace, with where this pace ends it and when it would run out. Below that: what used the week, by kind of work, with the coordinator and use outside Althar apart, and the costliest tasks. Then the weeks before, and the ones that ran out (Claude Code twice in the Fable fortnight). Last, what the plans carried at API prices, the only place dollars appear, with the token totals T3 shows.

**Cost to build:** small to medium, the cheapest of the four. The week's readings (`plan_usage_weeks`) and a task's share of the week (`tookOf`) already exist; the forecast is arithmetic on them. The window's plan gauge could open it.

**Missing:** what a plan costs. Althar knows "Max" and "Pro", not $200; it would need to ask once or keep a price table. History of the five-hour window: only the latest reading is kept (`plan_usage_readings`). Work moved by a limit is recorded (`usage_limit` asks, model moves) but not counted.

### D · Compare

**What it's for:** how this stretch went against the one before, as the person put it: tasks finished, changes merged, time to merge, clean first reviews, findings per change, abandoned work, cost per change and in all. Each figure has its days drawn over the period before's. Then where the time to merge goes: agents at work, checks, and waiting on you, in violet as everywhere it means you. More than half of it is waiting on you. Then how tasks ended, what moved most as a share of the work (Fable from 0% to 11% of tasks led), and every day of the history beside the busiest days.

**Cost to build:** large. Every figure is needed for two periods, and the most useful one, the split of the time to merge, rests on data that isn't kept yet.

**Missing:** `merged_at`; when a task became ready for the person, which would show how long it waited on them; how long checks took (read live from the host, not kept). Over 90 days there's nothing before the repository began, so the page says so rather than compare against zero.

## The pick

**C, with A's receipts as what it opens into.** A person on a plan asks "will I run out, and what's using it?" more often than anything else, and C answers it from data Althar already keeps, so it's the cheapest to build well. A task in "What used it" would open its receipt from A, which shows where a costly task's money went: the build, the fixes, a second review. B is the strongest second page: it's the one T3 can't have, and it turns choosing models into evidence. D is closest to the person's own words ("compare periods"), but it's the costliest and most of its best figure doesn't exist yet. Recording `merged_at` and when a task became ready would be worth doing early, whatever is picked.

## Screenshots

`shoot.mjs` shoots each direction, light and dark at full height, and narrow at 90 days, at 1×, into `lab/usage/shots` (git ignores it), with the lab running. It prints anything the page logs as an error. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/usage/shoot.mjs
node lab/usage/shoot.mjs one c dark 1440 900 "range=90&full=1"
```

Delete the lab once a direction is picked to build, before building it.

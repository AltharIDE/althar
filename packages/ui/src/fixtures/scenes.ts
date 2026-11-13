/*
 * Pages an agent made or opened, drawn whole, for the stories that show a
 * task with what it made beside it: a launch page a lead drew on the canvas,
 * and the refunds page a task's run serves, open in the browser. Each is a
 * page of its own, shown in a frame where the window would lay its view, so
 * a story needs no file. The font is the one Storybook already serves.
 */

const head = (style: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Inter Variable'; src: url('/fonts/inter/inter-latin-wght-normal.woff2') format('woff2-variations'); font-weight: 100 900; }
* { box-sizing: border-box; }
body { margin: 0; overflow: hidden; font: 14px/1.5 'Inter Variable', Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
${style}
</style></head><body>`

/** Tally's payouts launch page, at its third version: the headline bigger and bolder, today's payout on the card. */
export const LAUNCH_PAGE = `${head(`
body { color: #131316; background: #f8f5ef; }
nav { position: relative; z-index: 1; display: flex; align-items: center; gap: 22px; padding: 20px 34px; font-size: 13.5px; color: #55555d; }
.logo { display: flex; align-items: center; gap: 9px; margin-right: auto; font-size: 17px; font-weight: 750; letter-spacing: -0.03em; color: #131316; }
.logo i { width: 20px; height: 20px; border-radius: 7px; background: linear-gradient(135deg, #ff8a5c, #c04dff); }
nav b { padding: 7px 15px; border-radius: 999px; font-weight: 600; color: #fff; background: #131316; }
.mesh { position: absolute; right: -150px; top: 120px; width: 620px; height: 620px; border-radius: 50%; filter: blur(34px);
  background: radial-gradient(circle at 32% 30%, #ffb489 0, transparent 52%), radial-gradient(circle at 72% 42%, #dc72ff 0, transparent 54%), radial-gradient(circle at 46% 74%, #6c7cff 0, transparent 58%); }
.hero { position: relative; z-index: 1; padding: 46px 34px 0; }
.tag { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px 4px 4px; border-radius: 999px; font-size: 12.5px; color: #55555d; background: rgba(255, 255, 255, 0.8); box-shadow: 0 0 0 1px rgba(19, 19, 22, 0.08); }
.tag em { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-style: normal; font-weight: 650; color: #fff; background: #131316; }
h1 { max-width: 8.4ch; margin: 22px 0 16px; font-size: 68px; font-weight: 820; line-height: 0.96; letter-spacing: -0.055em; }
.sub { max-width: 25ch; margin: 0 0 26px; font-size: 17px; line-height: 1.45; color: #4b4b53; }
.cta { display: flex; gap: 10px; }
.cta span { padding: 11px 19px; border-radius: 999px; font-size: 14px; font-weight: 600; }
.go { color: #fff; background: #131316; }
.more { box-shadow: inset 0 0 0 1px rgba(19, 19, 22, 0.18); }
.card { position: absolute; z-index: 1; right: 34px; top: 318px; width: 268px; padding: 18px 18px 16px; border-radius: 18px; background: rgba(255, 255, 255, 0.82); backdrop-filter: blur(10px);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7), 0 24px 48px -18px rgba(70, 30, 110, 0.45); }
.label { display: flex; justify-content: space-between; font-size: 12px; color: #6b6b73; }
.label b { font-weight: 600; color: #1d8f4e; }
.sum { margin: 2px 0 14px; font-size: 32px; font-weight: 760; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
.bars { display: flex; align-items: flex-end; gap: 7px; height: 64px; }
.bars i { flex: 1; border-radius: 4px 4px 2px 2px; background: linear-gradient(180deg, #c35cff, #ff8a5c); }
.from { display: flex; justify-content: space-between; margin-top: 12px; padding-top: 11px; border-top: 1px solid rgba(19, 19, 22, 0.08); font-size: 12px; color: #6b6b73; }
.chip { position: absolute; z-index: 1; right: 214px; top: 560px; display: flex; align-items: center; gap: 9px; padding: 9px 13px 9px 10px; border-radius: 14px; font-size: 12.5px; background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7), 0 16px 32px -14px rgba(70, 30, 110, 0.4); }
.chip i { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: 12px; font-style: normal; color: #fff; background: #1d8f4e; }
.chip small { display: block; font-size: 11px; color: #6b6b73; }
`)}<div class="mesh"></div>
<nav><span class="logo"><i></i>tally</span><span>Payouts</span><span>Pricing</span><span>Docs</span><b>Sign in</b></nav>
<section class="hero">
<span class="tag"><em>New</em>Payouts, in 40 countries</span>
<h1>Payouts in forty seconds.</h1>
<p class="sub">Pay anyone, anywhere, from one balance. The money lands while they’re still on the call.</p>
<div class="cta"><span class="go">Get started</span><span class="more">See pricing</span></div>
</section>
<div class="card"><div class="label"><span>Arriving today</span><b>On time</b></div><div class="sum">€12,480.00</div>
<div class="bars"><i style="height:38%"></i><i style="height:52%"></i><i style="height:44%"></i><i style="height:66%"></i><i style="height:58%"></i><i style="height:80%"></i><i style="height:72%"></i><i style="height:100%"></i></div>
<div class="from"><span>From Northwind</span><span>14:02</span></div></div>
<div class="chip"><i>✓</i><span>Paid out to Halyard<small>38 seconds</small></span></div>
</body></html>`

const REFUNDS = [
  { id: 're_3Pq', who: 'Northwind', sum: '€42.00', state: 'Pending', tone: 'wait' },
  { id: 're_3Po', who: 'Ferrous', sum: '€28.00', state: 'Refunded', tone: 'ok', now: true },
  { id: 're_3Pp', who: 'Halyard', sum: '€35.00', state: 'Refunded', tone: 'ok' },
  { id: 're_3Pn', who: 'Tessera', sum: '€21.00', state: 'Refunded', tone: 'ok' },
  { id: 're_3Pm', who: 'Meridian', sum: '€14.00', state: 'Refunded', tone: 'ok' },
  { id: 're_3Pl', who: 'Northwind', sum: '€61.50', state: 'Refunded', tone: 'ok' },
  { id: 're_3Pk', who: 'Ferrous', sum: '€9.90', state: 'Refunded', tone: 'ok' },
] as const

/** Acme's refunds page, served by a task's run: the failed refund just retried, refunded now. */
export const REFUNDS_PAGE = `${head(`
body { color: #1c1c21; background: #f6f5f1; }
header { display: flex; align-items: center; gap: 20px; height: 54px; padding: 0 24px; font-size: 13px; color: #6b6b73; background: #fff; border-bottom: 1px solid #e6e3dc; }
.logo { display: flex; align-items: center; gap: 8px; margin-right: 6px; font-size: 14px; font-weight: 650; color: #1c1c21; }
.logo i { width: 18px; height: 18px; border-radius: 5px; background: #26262b; }
header .on { color: #1c1c21; font-weight: 600; }
header u { margin-left: auto; width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, #d6d2c8, #b9b4a8); }
main { padding: 26px 24px; }
.top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
h1 { margin: 0; font-size: 24px; font-weight: 680; letter-spacing: -0.03em; }
.export { padding: 7px 13px; border-radius: 8px; font-size: 13px; font-weight: 550; background: #fff; box-shadow: inset 0 0 0 1px #dedad2; }
.tabs { display: flex; gap: 6px; margin-bottom: 14px; font-size: 13px; color: #6b6b73; }
.tabs span { padding: 5px 11px; border-radius: 999px; }
.tabs .on { color: #1c1c21; font-weight: 600; background: #fff; box-shadow: inset 0 0 0 1px #dedad2; }
.rows { display: grid; gap: 6px; }
.row { display: grid; grid-template-columns: 62px minmax(0, 1fr) 64px 84px 96px; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 10px; font-size: 13.5px; background: #fff; box-shadow: 0 0 0 1px #e9e6df; }
.row code { font: 500 12.5px ui-monospace, Menlo, monospace; color: #6b6b73; }
.row .sum { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.state { justify-self: start; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.ok { color: #23753d; background: #e2f2e6; }
.wait { color: #94570f; background: #fbeedb; }
.act { justify-self: end; font-size: 12.5px; color: #8a8a92; }
.now { box-shadow: 0 0 0 1.5px #3fa260, 0 6px 18px -8px rgba(35, 117, 61, 0.45); }
.toast { position: absolute; left: 50%; bottom: 22px; translate: -50% 0; display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-radius: 12px; font-size: 13px; white-space: nowrap; color: #fff; background: #1c1c21; box-shadow: 0 14px 30px -12px rgba(0, 0, 0, 0.5); }
.toast i { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; font-size: 11px; font-style: normal; background: #3fa260; }
`)}<header><span class="logo"><i></i>Acme</span><span>Payments</span><span class="on">Refunds</span><span>Payouts</span><span>Customers</span><u></u></header>
<main>
<div class="top"><h1>Refunds</h1><span class="export">Export</span></div>
<div class="tabs"><span class="on">All</span><span>Pending 1</span><span>Failed 0</span></div>
<div class="rows">${REFUNDS.map(
  (r) =>
    `<div class="row${'now' in r ? ' now' : ''}"><code>${r.id}</code><span>${r.who}</span><span class="sum">${r.sum}</span><span class="state ${r.tone}">${r.state}</span><span class="act">${r.tone === 'wait' ? 'Retry at 14:32' : '…'}</span></div>`,
).join('')}</div>
</main>
<div class="toast"><i>✓</i>Refund re_3Po retried · €28.00 back with Ferrous</div>
</body></html>`

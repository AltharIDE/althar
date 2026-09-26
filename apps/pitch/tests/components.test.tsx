import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LAB_NAME, labOf, Mark, MarkAt } from '../src/pages/brief/Mark'
import { HAND, STEPS } from '../src/pages/brief/model/data'
import { frontierReached, LEADERS, labsSince, OPEN, openIn, reigns, yearStats } from '../src/pages/brief/model/frontier'
import { Card, Dag, FlowList } from '../src/pages/brief/slides/Coordinator'
import { day, Models, place, Year } from '../src/pages/brief/slides/Models'
import { Checklist, handClock, Morning } from '../src/pages/brief/slides/Morning'
import { Open } from '../src/pages/brief/slides/Open'
import { Board, Standup, Team } from '../src/pages/brief/slides/Team'

const count = (html: string, re: RegExp): number => html.match(re)?.length ?? 0
/** Prerendered markup without React's text separators. */
const text = (html: string): string => html.replaceAll('<!-- -->', '')

describe('Dag', () => {
  it('grows by one node and one edge per step, with one current node', () => {
    for (let i = 0; i < STEPS.length; i++) {
      const h = renderToString(<Dag i={i} />)
      expect(count(h, /<rect /g)).toBe(i + 1 + (i < STEPS.length - 1 ? 1 : 0))
      const edges = STEPS.slice(1, i + 1).reduce((n, st) => n + 1 + (st.also === undefined ? 0 : 1), 0)
      expect(count(h, /<path [^>]*pathLength/g)).toBe(edges)
    }
  })
  it('drops the placeholder once the graph is complete', () => {
    expect(renderToString(<Dag i={STEPS.length - 2} />)).toContain('?')
    expect(renderToString(<Dag i={STEPS.length - 1} />)).not.toContain('>?<')
  })
})

describe('Card', () => {
  it('numbers the step and explains the ones the evidence added', () => {
    expect(renderToString(<Card i={0} />)).toMatch(/<b>01<\/b>\/ (<!-- -->)?9/)
    expect(renderToString(<Card i={5} />)).toContain('Not in the plan. Added because <b>review found the same bug')
    expect(renderToString(<Card i={8} />)).toContain('Back on the main line')
  })
})

describe('FlowList', () => {
  it('lists every step, with the added ones tagged', () => {
    const h = renderToString(<FlowList />)
    expect(count(h, /<li>/g)).toBe(STEPS.length)
    expect(count(h, /Added · /g)).toBe(STEPS.filter((s) => s.add).length)
  })
})

describe('Morning, prerendered', () => {
  const h = text(renderToString(<Morning />))
  it('shows the final state: the whole morning and what it cost', () => {
    expect(h).toContain('Merged at 11:40.')
    expect(h).toContain('09:00–11:40')
    expect(h).toMatch(/<dd>62<\/dd>.*<dd>5<\/dd>.*<dd>2<small>/s)
  })
  it('gets one snap point per step', () => {
    expect(count(h, /<i class="[^"]*snap[^"]*"/g)).toBe(HAND.length + 2)
  })
})

describe('Checklist', () => {
  it('starts with every step still to come', () => {
    const h = renderToString(<Checklist k={0} />)
    expect(count(h, /<li /g)).toBe(HAND.length)
    expect(h).not.toContain('Never ran')
  })
  it('marks the steps nobody remembered, as they come up', () => {
    const forgot = HAND.findIndex((e) => e.fate === 'forgot')
    expect(renderToString(<Checklist k={forgot} />)).not.toContain('Never ran')
    expect(renderToString(<Checklist k={forgot + 1} />)).toContain('Never ran')
    expect(count(renderToString(<Checklist k={HAND.length + 1} />), /Never ran/g)).toBe(2)
  })
  it('shows what a lossy hand-off lost', () => {
    expect(renderToString(<Checklist k={HAND.length} />)).toContain('2 of 3 findings passed on')
  })
})

describe('handClock', () => {
  it('reads the last time you looked, then the whole morning', () => {
    expect(handClock(0)).toBe('09:00')
    expect(handClock(1)).toBe('09:22')
    expect(handClock(3)).toBe('10:04')
    expect(handClock(HAND.length + 1)).toBe('09:00–11:40')
  })
})

describe('Mark', () => {
  it('knows the labs behind the agents the brief names', () => {
    expect(labOf('Claude Code')).toBe('anthropic')
    expect(labOf('GPT-5.4')).toBe('openai')
    expect(labOf('o3-pro')).toBe('openai')
    expect(labOf('Gemini CLI')).toBe('google')
    expect(labOf('Grok 4')).toBe('xai')
    expect(labOf('Self-hosted')).toBe('self')
    expect(labOf('Coordinator')).toBeUndefined()
  })
  it('knows the open-weights labs too, and names every lab', () => {
    expect(labOf('GLM-5.3')).toBe('zai')
    expect(labOf('Kimi K3')).toBe('moonshot')
    expect(labOf('Qwen3.8')).toBe('qwen')
    expect(labOf('DeepSeek V4 Pro')).toBe('deepseek')
    expect(labOf('MiniMax-M3')).toBe('minimax')
    expect(labOf('Cursor')).toBe('cursor')
    expect(LAB_NAME.zai).toBe('Z.ai')
    expect(renderToString(<Mark lab="zai" />)).toContain('>Z<')
    expect(renderToString(<MarkAt lab="zai" x={0} y={0} size={10} />)).toBe('')
  })
  it('draws nothing for an unknown lab, and a letter for xAI', () => {
    expect(renderToString(<Mark lab={undefined} />)).toBe('')
    expect(renderToString(<Mark lab="xai" />)).toContain('>x<')
    expect(renderToString(<Mark lab="openai" />)).toContain('<path')
    expect(renderToString(<MarkAt lab="xai" x={0} y={0} size={10} />)).toBe('')
    expect(renderToString(<MarkAt lab="google" x={4} y={5} size={10} />)).toContain('x="4"')
  })
})

describe('the frontier', () => {
  it('only lists releases that beat everything before them', () => {
    LEADERS.forEach((l, j) => {
      if (j === 0) return
      expect(l.score).toBeGreaterThan(LEADERS[j - 1]!.score)
      expect(l.on > LEADERS[j - 1]!.on).toBe(true)
    })
  })
  it('fills each year end to end, up to the day it was read', () => {
    for (const y of [2023, 2024, 2025]) {
      const r = reigns(y)
      expect(r[0]!.from).toBe(0)
      expect(r.at(-1)!.to).toBe(1)
      r.slice(1).forEach((x, j) => expect(x.from).toBeCloseTo(r[j]!.to))
    }
    const now = reigns(2026)
    expect(now.at(-1)!.now).toBe(true)
    expect(now.at(-1)!.to).toBeLessThan(1)
  })
  it('changes hands faster: more new leaders and bigger gains', () => {
    expect(yearStats(2023)).toEqual({ leaders: 2, gain: 1.5 })
    expect(yearStats(2024)).toEqual({ leaders: 3, gain: 8.2 })
    expect(yearStats(2025)).toEqual({ leaders: 11, gain: 15.2 })
    expect(yearStats(2026)).toEqual({ leaders: 8, gain: 27.2 })
  })
  it('handles a year before the data starts', () => {
    expect(yearStats(2021)).toEqual({ leaders: 0, gain: 0 })
  })
  it('only lists open models at least as good as the top of six months before', () => {
    const DAY = 86_400_000
    for (const o of OPEN) {
      const back = new Date(Date.parse(o.on) - 182 * DAY).toISOString().slice(0, 10)
      const top = LEADERS.filter((l) => l.on <= back).at(-1)!
      expect(o.score).toBeGreaterThanOrEqual(top.score)
    }
    expect(openIn(2024)).toHaveLength(1)
    expect(openIn(2025)).toHaveLength(8)
    expect(openIn(2026)).toHaveLength(19)
    expect(openIn(2026)[0]!.at).toBeGreaterThan(0)
  })
  it('finds when the frontier first reached a score', () => {
    expect(frontierReached(46.3)).toBe('2026-06-09')
    expect(frontierReached(99)).toBeUndefined()
  })
  it('counts four labs at the top since 2024', () => {
    expect(labsSince(2024).toSorted()).toEqual(['anthropic', 'google', 'openai', 'xai'])
  })
})

describe('Models', () => {
  const h = text(renderToString(<Models />))
  it('prerenders every year, with a snap point per year and one for the open models', () => {
    expect(count(h, /<i class="[^"]*snap[^"]*"/g)).toBe(5)
    expect(h).toContain('And one you can run yourself ships every two weeks.')
    expect(h).toContain('The best, MiMo-V2.6-Pro, matches the frontier of June.')
    expect(h).toContain('19 so far this year from seven labs')
    for (const y of ['2023', '2024', '2025', '2026']) expect(h).toContain(`>${y}<`)
    expect(h).toContain('Four labs have held it since 2024.')
  })
  it('hatches the rest of the current year only', () => {
    expect(renderToString(<Year year={2026} state="now" />)).toMatch(/class="[^"]*rest/)
    expect(renderToString(<Year year={2025} state="seen" />)).not.toMatch(/class="[^"]*rest/)
    expect(renderToString(<Year year={2023} state="next" />)).toContain('model')
  })
  it('captions every tile and dot for hover, with its exact date', () => {
    const y = text(renderToString(<Year year={2025} state="now" />))
    expect(y).toContain('<b>Claude Opus 4.5</b> Anthropic · 24 Nov 2025')
    expect(y).toContain('<b>Kimi K2 Thinking</b> Moonshot AI · 6 Nov 2025')
    expect(day('2023-03-14')).toBe('14 Mar 2023')
  })
  it('places crowded dots on a second lane, then nudges them only when both are taken', () => {
    expect(place([0.1, 0.5])).toEqual([
      { x: 0.1, lane: 0 },
      { x: 0.5, lane: 0 },
    ])
    expect(place([0.5, 0.5, 0.5], 0.02)).toEqual([
      { x: 0.5, lane: 0 },
      { x: 0.5, lane: 1 },
      { x: 0.52, lane: 0 },
    ])
    expect(place([0.5, 0.5, 0.5, 0.5], 0.06, 3)).toEqual([
      { x: 0.5, lane: 0 },
      { x: 0.5, lane: 1 },
      { x: 0.5, lane: 2 },
      { x: 0.56, lane: 0 },
    ])
  })
})

describe('Standup', () => {
  it('shows one decision for you, and the work still running', () => {
    const h = renderToString(<Standup />)
    expect(h).toContain('If token rotation fails, should the request fail, or retry once?')
    expect(count(h, /PR #\d+/g)).toBe(1)
    expect(h).toContain('Found by the security review.')
    expect(h).toContain('You were away 14 hours')
  })
})

describe('Board', () => {
  it('lays the same morning out as columns, with the decision beside the running work', () => {
    const h = text(renderToString(<Board />))
    for (const k of ['Up next', 'Running', 'Needs you', 'Settled']) expect(h).toContain(`<i></i>${k}`)
    expect(h.indexOf('Running')).toBeLessThan(h.indexOf('Needs you'))
    expect(h).toContain('Drop legacy_sessions table')
    expect(h).toContain('Starts when 419 merges')
  })
  it('pins two views, the stand-up then the board', () => {
    const h = renderToString(<Team />)
    expect(count(h, /<i class="[^"]*snap[^"]*"/g)).toBe(2)
    expect(h).toContain('You were away 14 hours')
    expect(h).toContain('Starts when 419 merges')
  })
})

describe('Open', () => {
  it('prerenders all four beats, the lead’s review included', () => {
    const h = renderToString(<Open />)
    expect(count(h, /<i class="[^"]*snap[^"]*"/g)).toBe(4)
    expect(h).toContain('What if the vendor goes away?')
    expect(h).toContain('No lock-in to weigh')
  })
})

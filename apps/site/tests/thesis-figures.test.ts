import { describe, expect, it } from 'vite-plus/test'

import { THESIS_SOURCE } from '../src/thesis/Thesis'
import { classifyFigure, figureLabels } from '../src/thesis/ThesisFigure'

const figures = [...THESIS_SOURCE.matchAll(/```text\n([\s\S]*?)```/g)].map((match) => match[1]?.trim() ?? '')

describe('thesis figures', () => {
  it('recognises every figure in the thesis', () => {
    expect(figures).toHaveLength(13)
    expect(figures.map((figure) => classifyFigure(figure).kind)).not.toContain('fallback')
  })

  it('derives every visible label from the unchanged source', () => {
    for (const figure of figures) {
      const labels = figureLabels(figure)
      expect(labels.length).toBeGreaterThan(0)
      for (const label of labels) expect(figure).toContain(label)
    }
  })

  it('keeps every word of a fork available to draw', () => {
    const specialist = figures.find((figure) => figure.includes('Security review')) ?? ''
    expect(figureLabels(specialist)).toEqual(
      expect.arrayContaining(['Implement', 'Security review', 'Code review', 'Test agent', 'Repair', 'Re-review']),
    )
    const execution = figures.find((figure) => figure.includes('Requirements') && figure.includes('Pass')) ?? ''
    expect(figureLabels(execution)).toEqual(expect.arrayContaining(['Requirements', 'Implement', 'Review', 'Test', 'Pass', 'Fail', 'Done']))
    const providers = figures.find((figure) => figure.includes('Open layer')) ?? ''
    expect(figureLabels(providers)).toEqual(
      expect.arrayContaining(['Persistent scopes', 'Open layer', 'Model A', 'Model B', 'Local agent', 'Future model']),
    )
  })

  it('keeps unknown code as a fallback instead of guessing at its meaning', () => {
    expect(classifyFigure('const answer = 42')).toEqual({
      kind: 'fallback',
      variant: 'plain',
      labels: ['const answer = 42'],
    })
  })

  it('splits a branched figure into the words beside each dot', () => {
    const execution = figures.find((figure) => figure.includes('Requirements') && figure.includes('Pass'))
    expect(execution).toBeTruthy()
    expect(figureLabels(execution ?? '')).toEqual([
      'Review',
      'Requirements',
      'Implement',
      'Repair',
      'Re-review',
      'Test',
      'Pass',
      'Fail',
      'Done',
      'Repair',
    ])
  })
})

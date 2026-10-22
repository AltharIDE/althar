// Scrappy: a row's note in All models (ModelBrowser), which has no slot for one: the server's patch calls `browserNote(model)` in each row, and the model seam sets what it draws, per model.
import type { ModelInfo } from '@althar/ui'
import type { ReactNode } from 'react'

let draw: ((model: ModelInfo) => ReactNode) | null = null

export const setBrowserNote = (next: typeof draw) => {
  draw = next
}

export const browserNote = (model: ModelInfo): ReactNode => draw?.(model) ?? null

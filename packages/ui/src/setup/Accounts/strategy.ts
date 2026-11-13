/** How new conversations choose among an agent's allowed accounts. */
export type AccountStrategy = 'first' | 'most_room' | 'least_room' | 'random' | 'in_order'

export const accountStrategies: Record<AccountStrategy, { label: string; note: string }> = {
  first: { label: 'Stay on the first account', note: 'Use the first signed-in account in Settings order. Automatic switching is off.' },
  most_room: { label: 'Least depleted first', note: 'Start with the most usage left. Switch accounts when usage runs low.' },
  least_room: { label: 'Most depleted first', note: 'Use the least usage left first, keeping accounts below 5% for later.' },
  random: { label: 'Random', note: 'Choose an available account at random for each new conversation.' },
  in_order: { label: 'Account order', note: 'Follow Settings order, skipping accounts without enough usage.' },
}

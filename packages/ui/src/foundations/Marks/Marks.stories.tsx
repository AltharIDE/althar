import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'

import { Brand, BRANDS } from '../brands/brands'
import { labBrand, sourceBrand } from '../brands/resolve'
import { Lab, SourceKind } from '../vocabulary'
import { BrandMark } from './Marks'
import s from './Marks.stories.module.css'
import { States } from '../../storybook/States'

const meta = {
  title: 'Foundations/Marks',
  component: BrandMark,
  args: { brand: Brand.GitHub, size: 16 },
} satisfies Meta<typeof BrandMark>
export default meta
type Story = StoryObj<typeof meta>

export const Mark: Story = {}

function Grid({ items }: { items: { key: string; mark: ReactNode; name: string }[] }) {
  return (
    <ul className={s.grid}>
      {items.map((it) => (
        <li key={it.key} className={s.cell}>
          <span className={s.sizes}>{it.mark}</span>
          <span className={s.name}>{it.name}</span>
        </li>
      ))}
    </ul>
  )
}

const sizes = (draw: (size: number) => ReactNode) => (
  <>
    {draw(12)}
    {draw(16)}
    {draw(24)}
  </>
)

/** Every lab, with the mark `labBrand` gives its models, at the sizes the product uses. */
export const Labs: Story = {
  render: () => (
    <Grid
      items={Object.values(Lab).map((lab) => ({
        key: lab,
        name: lab,
        mark: sizes((size) => <BrandMark brand={labBrand(lab)} size={size} />),
      }))}
    />
  ),
}

/** Where work comes from, by `sourceBrand`: code hosts, trackers, docs, incidents. CI has no single brand, so none is drawn. */
export const Sources: Story = {
  render: () => (
    <Grid
      items={Object.values(SourceKind).map((kind) => ({
        key: kind,
        name: kind,
        mark: sizes((size) => {
          const brand = sourceBrand(kind)
          return brand && <BrandMark brand={brand} size={size} />
        }),
      }))}
    />
  ),
}

/** Every mark there is, by name. Drawn in ink: brand colour is not used, apart from Linear's issue card. */
export const Everything: Story = {
  render: () => (
    <Grid
      items={Object.values(Brand).map((brand) => ({
        key: brand,
        name: BRANDS[brand].name,
        mark: sizes((size) => <BrandMark brand={brand} size={size} />),
      }))}
    />
  ),
}

/** A mark at each size, in each ink it is drawn in, and Linear's on its own card. */
export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: '12', node: <BrandMark brand={Brand.Jira} size={12} /> },
        { state: '16', node: <BrandMark brand={Brand.Jira} size={16} /> },
        { state: '24', node: <BrandMark brand={Brand.Jira} size={24} /> },
        {
          state: 'metadata',
          node: (
            <span style={{ color: 'var(--t-3)' }}>
              <BrandMark brand={Brand.Confluence} />
            </span>
          ),
        },
        {
          state: 'on ink',
          dark: true,
          node: (
            <span style={{ color: '#f2f0ea' }}>
              <BrandMark brand={Brand.GitHub} />
            </span>
          ),
        },
        {
          state: 'linear card',
          node: (
            <span style={{ color: 'var(--linear)' }}>
              <BrandMark brand={Brand.Linear} />
            </span>
          ),
        },
        { state: 'two-tone', node: <BrandMark brand={Brand.LMStudio} size={16} /> },
      ]}
    />
  ),
}

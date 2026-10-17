// Scrappy: C, one page in the rules' own way: every section one after another, each part of it labelled down the left as the rules' clauses are, the way to each held at the top.
import { type ReactNode, useEffect } from 'react'

import { Button, LinkButton, SettingList } from '../../../src/index'
import {
  AllowEverything,
  AppWide,
  Conflicts,
  Identity,
  MoveIssues,
  Notes,
  overlay,
  RemoveRow,
  RunRows,
  type Things,
  TrackerRows,
  WhereRows,
} from '../parts'
import { RepositoriesScreen, RulesScreen, sectionText } from '../sections'
import { SECTIONS, type Section, useProto } from '../state'
import c from './pages.module.css'

function Clause({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={c.clause}>
      <p className={c.label}>{label}</p>
      <div>{children}</div>
    </div>
  )
}

function Part({ id, children }: { id: Section; children: ReactNode }) {
  return (
    <section id={`c-${id}`} className={c.section}>
      <h2 className={c.sectionTitle}>{sectionText[id].title}</h2>
      <p className={c.sectionLede}>{sectionText[id].lede}</p>
      {children}
    </section>
  )
}

const jump = (id: Section) => document.getElementById(`c-${id}`)?.scrollIntoView({ block: 'start' })

export function C({ things }: { things: Things }) {
  const section = useProto().section
  // Opened at a section, as the picker or a link says: there.
  useEffect(() => {
    if (section !== null && section !== 'general') setTimeout(() => jump(section), 300)
  }, [section])
  return (
    <div className={c.page}>
      <div className={c.wide}>
        <div className={c.held}>
          <nav className={c.jump} aria-label="Sections">
            {SECTIONS.map((id) => (
              <LinkButton key={id} onClick={() => jump(id)}>
                {sectionText[id].title}
              </LinkButton>
            ))}
          </nav>
        </div>
        <Part id="general">
          <div className={c.clauses}>
            <Clause label="Name">
              <Identity things={things} />
            </Clause>
            <Clause label="Every task">
              <SettingList>
                <AllowEverything things={things} />
                <Conflicts things={things} />
              </SettingList>
            </Clause>
          </div>
        </Part>
        <Part id="code">
          <div className={c.clauses}>
            <Clause label="Repositories">
              <RepositoriesScreen />
            </Clause>
            <Clause label="Trackers">
              <SettingList>
                <TrackerRows things={things}>
                  <MoveIssues things={things} indent />
                </TrackerRows>
              </SettingList>
              <div style={{ marginTop: 12 }}>
                <AppWide things={things} />
              </div>
            </Clause>
          </div>
        </Part>
        <Part id="rules">
          <RulesScreen />
        </Part>
        <Part id="running">
          <div className={c.clauses}>
            <Clause label="Runs">
              <SettingList>
                <RunRows things={things} />
              </SettingList>
              <div style={{ marginTop: 10 }}>
                <Button size="small" onClick={() => overlay.set({ runs: true })}>
                  Edit list
                </Button>
              </div>
            </Clause>
            <Clause label="Work goes">
              <SettingList>
                <WhereRows things={things} />
              </SettingList>
            </Clause>
          </div>
        </Part>
        <Part id="notes">
          <Notes things={things} />
        </Part>
        <section className={c.section}>
          <div className={c.clauses}>
            <Clause label="Remove">
              <SettingList>
                <RemoveRow things={things} />
              </SettingList>
            </Clause>
          </div>
        </section>
      </div>
    </div>
  )
}

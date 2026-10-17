// Scrappy: D, an overview first: the project's name and its switches, then a card per section saying what it holds now; each opens a page of its own, the overview a crumb away.
import { Button, LinkButton, Panel, SettingList } from '../../../src/index'
import { AllowEverything, Conflicts, IdentityRow, LinkRow, MoveIssues, NotesRow, overlay, RulesRow, RunsRow, type Things } from '../parts'
import { Body, sectionText } from '../sections'
import { proto, type Section, useProto } from '../state'
import c from './pages.module.css'

const go = (section: Section | null) => proto.set({ section })

function Card({ id, things, across, children }: { id: Section; things: Things; across?: boolean; children: React.ReactNode }) {
  const text = sectionText[id]
  return (
    <div className={across === true ? c.across : undefined}>
      <Panel
        title={text.title}
        lede={id === 'code' && things.troubles > 0 ? 'A connection needs you.' : text.lede}
        foot={
          <LinkButton onClick={() => go(id)}>
            {id === 'rules' ? 'All the rules' : id === 'notes' ? 'Read them all' : `All of ${text.title.toLowerCase()}`}
          </LinkButton>
        }
      >
        <div className={c.card}>{children}</div>
      </Panel>
    </div>
  )
}

function Overview({ things }: { things: Things }) {
  return (
    <>
      <div className={c.cards}>
        <Card id="general" things={things}>
          <SettingList>
            <IdentityRow things={things} onChange={() => go('general')} />
            <AllowEverything things={things} />
            <Conflicts things={things} />
          </SettingList>
        </Card>
        <Card id="code" things={things}>
          <SettingList>
            {things.host !== null && <LinkRow link={things.host} things={things} />}
            {things.trackers.map((link) => (
              <LinkRow key={link.id} link={link} things={things} />
            ))}
            <MoveIssues things={things} />
          </SettingList>
        </Card>
        <Card id="rules" things={things}>
          <SettingList>
            <RulesRow things={things} onOpen={() => go('rules')} />
          </SettingList>
        </Card>
        <Card id="running" things={things}>
          <SettingList>
            <RunsRow things={things} />
          </SettingList>
        </Card>
        <Card id="notes" things={things} across>
          <SettingList>
            <NotesRow things={things} onOpen={() => go('notes')} />
          </SettingList>
        </Card>
      </div>
      <div className={c.foot}>
        <span>Taking {things.name} out of Althar leaves its repositories and branches as they are.</span>
        <Button size="small" variant="quiet" onClick={() => overlay.set({ removing: true })}>
          Remove project…
        </Button>
      </div>
    </>
  )
}

export function D({ things }: { things: Things }) {
  const section = useProto().section
  return (
    <div className={c.page}>
      <div className={c.wide}>
        {section === null ? (
          <Overview things={things} />
        ) : (
          <>
            <div className={c.crumb}>
              <LinkButton onClick={() => go(null)}>← All settings</LinkButton>
            </div>
            <Panel key={section} title={sectionText[section].title} lede={sectionText[section].lede} headingLevel={1}>
              <div className={c.body}>
                <Body section={section} things={things} />
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}

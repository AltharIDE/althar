import { cx } from '../../../lib/cx'
import s from '../Research.module.css'

export function Tacit() {
  return (
    <>
      <section className={s.s} id="s8">
        <p className={s.sN}>8 · Knowledge model</p>
        <h2>A project memory must account for what can’t be written down.</h2>
        <div className={s.prose}>
          <p>
            Dave Snowden, extending Michael Polanyi’s observation about tacit knowledge, puts it simply: we know more than we can say, and
            we can say more than we can write down. His paper “Complex Acts of Knowing” rejects the idea that organisational knowledge
            reduces to a complete repository of documents. For Althar that is a design constraint. Project memory shouldn’t claim to capture
            everything. It should make the limits of its knowledge visible.
          </p>
        </div>
        <ul className={cx(s.ticksList, s.proseList)}>
          <li>
            Claims carry <b>scope, provenance, confidence and freshness</b>, not only text.
          </li>
          <li>
            <b>Conflicting accounts stay inspectable</b> instead of being merged early into one “truth”.
          </li>
          <li>
            Tasks record which assumptions a <b>person supplied</b>, an <b>agent inferred</b>, or <b>evidence verified</b>.
          </li>
          <li>
            The system knows <b>when to ask</b> a developer who holds relevant tacit knowledge.
          </li>
          <li>
            Repeated interventions can reveal a candidate policy, but <b>promotion is deliberate</b>.
          </li>
          <li>
            Claims that haven’t been supplied or checked in a long time are <b>flagged as possibly stale</b>, not trusted by default.
          </li>
        </ul>
        <div className={s.prose}>
          <p>
            At team scale the problem gets harder. Context should be shared, but not all of it belongs at organisation level. A deployment
            policy may be shared; a temporary workaround should not be. The relationship between organisation, project and task is a
            research question, not just a database hierarchy.
          </p>
        </div>
      </section>
    </>
  )
}

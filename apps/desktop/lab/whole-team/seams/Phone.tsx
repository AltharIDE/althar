import { Evidence } from './team'
import s from './phone.module.css'

/* C on Ana's phone: what the notification opens, the same evidence at a phone's width, the two ways on at its foot. */
export function PhoneDesk() {
  return (
    <div className={s.desk}>
      <div className={s.phone}>
        <div className={s.status}>
          <span>9:41</span>
          <span className={s.notch} />
          <span>althar</span>
        </div>
        <div className={s.screen}>
          <Evidence narrow />
        </div>
      </div>
      <div className={s.note}>
        <p className={s.noteTitle}>On Ana’s phone</p>
        <p>
          The notification “Maya asks you to approve Warmer words on an empty board” opens this, from Ana’s paired Althar. Pictures rather
          than Maya’s running copy: a phone can’t reach the copy on Maya’s computer.
        </p>
      </div>
    </div>
  )
}

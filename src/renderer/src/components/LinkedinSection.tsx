import { LinkedinLogo } from '@phosphor-icons/react'
import { useApp } from '../state'
import { Seg } from './ui'

/** Settings: LinkedIn from your own profile, in a LeadPitch window. */
export function LinkedinSection() {
  const { data, toast } = useApp()
  const li = data.linkedinStatus
  const s = data.settings.linkedin
  const tone = li.connected ? 'pos' : ''

  return (
    <section>
      <h2 className="section-title">LinkedIn</h2>
      <div className="card">
        <div className="conn">
          <div className="conn-ic"><LinkedinLogo size={20} /></div>
          <div style={{ minWidth: 0 }}>
            <b>Your LinkedIn profile</b>
            <span>{li.connected ? `${li.sentToday} of ${s.dailyLimit} notes sent today. Signed in inside LeadPitch's LinkedIn window.` : 'Send connection notes and messages from your own profile.'}</span>
          </div>
          <span className={`chip ${tone}`}><span className={`dot ${tone ? '' : 'idle'}`} />{li.connected ? 'Connected' : 'Not connected'}</span>
        </div>
        <div className="set-row">
          <div>
            <b>{li.connected ? 'LinkedIn window' : 'Connect'}</b>
            <span>
              You sign in to LinkedIn yourself, in a LeadPitch window. The sign-in stays in that window, separate from your browser, and LeadPitch never sees your password.
              Google sign-in is blocked there by Google; use your LinkedIn email and password.
            </span>
          </div>
          <div className="ctl">
            {li.connected && <button className="btn btn-plain" onClick={async () => { await window.lp.linkedin.disconnect(); toast('Signed out of LinkedIn in LeadPitch') }}>Sign out</button>}
            <button className={`btn ${li.connected ? 'btn-ghost' : 'btn-primary'}`} onClick={() => window.lp.linkedin.open()}><LinkedinLogo size={14} />{li.connected ? 'Open' : 'Connect LinkedIn'}</button>
          </div>
        </div>
        <div className="set-row">
          <div>
            <b>How sending works</b>
            <span>
              From a lead, choose Message on LinkedIn. LeadPitch opens their profile, or a search for the decision maker, with your note ready to paste.
              You press Connect or Message, then Send. LeadPitch never presses them for you: LinkedIn restricts accounts that software drives, and this keeps yours safe.
            </span>
          </div>
        </div>
        <div className="set-row">
          <div><b>Daily limit</b><span>LinkedIn limits invitations, about 100 a week on most accounts. 20 a day is a safe pace.</span></div>
          <Seg label="LinkedIn daily limit" value={String(s.dailyLimit)} onChange={(v) => window.lp.settings.update({ linkedin: { ...s, dailyLimit: Number(v) } })} options={['10', '20', '30', '40'].map((v) => ({ value: v, label: v }))} />
        </div>
      </div>
    </section>
  )
}

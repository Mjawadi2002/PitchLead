import { motion } from 'motion/react'
import { useState } from 'react'
import { CheckCircle, Circle, WarningCircle } from '@phosphor-icons/react'
import { spring, useApp } from '../state'
import { Logo } from './ui'

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { claude, refreshClaude, data } = useApp()
  const [name, setName] = useState(data.settings.senderName)
  const [checking, setChecking] = useState(false)

  const installed = !!claude?.found
  const signedIn = !!claude?.loggedIn
  const recheck = async () => {
    setChecking(true)
    await refreshClaude()
    setChecking(false)
  }
  const finish = async () => {
    await window.lp.settings.update({ onboarded: true, senderName: name.trim() })
    onClose()
  }
  const Mark = ({ ok, warn }: { ok: boolean; warn?: boolean }) =>
    ok ? <CheckCircle size={22} weight="fill" color="var(--pos)" /> : warn ? <WarningCircle size={22} weight="fill" color="var(--warn)" /> : <Circle size={22} color="var(--fg-3)" />

  return (
    <motion.div className="scrim" style={{ alignItems: 'center', paddingTop: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="modal" role="dialog" aria-label="Welcome to Leadpitch" initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={spring}>
        <Logo size={48} />
        <div>
          <h2>Welcome to Leadpitch</h2>
          <p style={{ marginTop: 6 }}>Leadpitch uses Claude Code on this computer to research companies, score them and write how to reach them. Your Claude subscription covers it, so no API key is needed.</p>
        </div>

        <div className="check-row">
          <Mark ok={installed} warn={!!claude && !installed} />
          <div className="grow">
            <b>Claude Code installed</b>
            <span>{installed ? `Version ${claude?.version}` : claude ? 'Install it, then check again.' : 'Checking'}</span>
          </div>
          {!installed && claude && (
            <button className="btn btn-ghost" onClick={() => window.lp.shell.open('https://docs.claude.com/en/docs/claude-code/setup')}>How to install</button>
          )}
        </div>

        <div className="check-row">
          <Mark ok={signedIn} warn={installed && !signedIn} />
          <div className="grow">
            <b>Signed in to Claude</b>
            <span>
              {signedIn
                ? claude?.authMethod === 'apikey'
                  ? 'Using your API key'
                  : `${claude?.email ?? 'Signed in'}${claude?.subscription ? ` · ${claude.subscription} plan` : ''}`
                : 'A terminal opens. Follow the steps there, then check again.'}
            </span>
          </div>
          {installed && !signedIn && <button className="btn btn-ghost" onClick={() => window.lp.claude.signIn()}>Sign in</button>}
        </div>

        <div className="field">
          <label htmlFor="onb-name">Your name</label>
          <input id="onb-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Used to sign outreach drafts" />
        </div>

        <div className="modal-foot">
          <button className="btn btn-plain" onClick={recheck} disabled={checking}>{checking ? 'Checking' : 'Check again'}</button>
          <button className="btn btn-primary" onClick={finish}>{installed && signedIn ? 'Start' : 'Continue anyway'}</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

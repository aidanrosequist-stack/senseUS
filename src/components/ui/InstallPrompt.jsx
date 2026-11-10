import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BOTTOM_NAV_HEIGHT_PX } from '../layout/BottomNav'
import {
  dismissInstallSuggestion,
  getInstallMode,
  promptInstall,
  subscribeToInstallChanges,
} from '../../lib/installPrompt'

// Small "Add senseUS to your home screen" card, floating just above the
// bottom nav. All the when-to-show rules live in lib/installPrompt.js;
// this only renders them.
//
// Only on Explore, Activity and Profile: Vote's card and Conversation's
// comment box both use the bottom of the screen, and a floating card
// there would sit on top of them.
const SHOW_ON_PATHS = new Set(['/explore', '/activity', '/profile'])

function ShareIcon() {
  // iOS "share" glyph (a box with an up arrow), so the instruction
  // matches what people actually see in Safari's toolbar.
  return (
    <svg width="14" height="16" viewBox="0 0 14 18" aria-hidden="true" style={{ verticalAlign: '-2px', margin: '0 2px' }}>
      <path d="M7 1v11M3.5 4.5L7 1l3.5 3.5" fill="none" stroke="#2D3DCA" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 7.5H2.5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8.5a1 1 0 0 0-1-1h-2" fill="none" stroke="#2D3DCA" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export default function InstallPrompt() {
  const { pathname } = useLocation()
  const [mode, setMode] = useState(() => getInstallMode())

  useEffect(() => subscribeToInstallChanges(() => setMode(getInstallMode())), [])

  if (!mode || !SHOW_ON_PATHS.has(pathname)) return null

  return (
    <div
      role="dialog"
      aria-label="Add senseUS to your home screen"
      style={{
        position: 'fixed',
        left: '12px',
        right: '12px',
        bottom: `calc(${BOTTOM_NAV_HEIGHT_PX}px + 10px + env(safe-area-inset-bottom, 0px))`,
        zIndex: 99,
        background: '#FFFFFF',
        borderRadius: '14px',
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.16)',
        border: '0.5px solid #E5E7EB',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontFamily: 'Merriweather, serif',
      }}
    >
      <img src="/icon-192.png" alt="" width="40" height="40" style={{ flexShrink: 0, borderRadius: '10px' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', marginBottom: '2px' }}>
          Add senseUS to your home screen
        </div>
        {mode === 'android' ? (
          <div style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.45 }}>
            One tap to open it like an app.
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.45 }}>
            Tap <ShareIcon /> Share, then <strong style={{ color: '#374151' }}>Add to Home Screen</strong>.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
        {mode === 'android' && (
          <button
            onClick={() => { promptInstall() }}
            style={{ padding: '7px 12px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
          >
            Install
          </button>
        )}
        <button
          onClick={dismissInstallSuggestion}
          style={{ padding: '6px 10px', background: 'transparent', color: '#6B7280', border: 'none', fontSize: '12px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}

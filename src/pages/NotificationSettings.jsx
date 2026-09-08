import { usePageTitle } from '../hooks/usePageTitle'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { HEADER_HEIGHT_PX } from '../components/layout/Header'
import { BOTTOM_NAV_HEIGHT_PX } from '../components/layout/BottomNav'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Toggle from '../components/ui/Toggle'

// Each entry: the notification_preferences column it controls, and the
// user-facing copy for it. Grouped the same way the "final touch"
// notification-planning conversation grouped them, and in the same
// order — personal activity first, achievements second, platform third.
// Security alerts aren't in this list at all: they're not a column in
// notification_preferences (see migration 075's own comment for why —
// short version, they're not meant to be optional), so that row below
// is just a locked/informational Toggle, not backed by real state.
const GROUPS = [
  {
    title: 'Your Activity',
    items: [
      { column: 'push_replies', label: 'Replies to your comments' },
      { column: 'push_comparison_accepted', label: 'Someone accepts your comparison invite' },
      { column: 'push_comment_milestone', label: 'Your comment reaches a reply milestone' },
    ],
  },
  {
    title: 'Achievements',
    items: [
      { column: 'push_badge_earned', label: 'You earn a badge' },
      { column: 'push_streak_ending', label: 'Your voting streak is about to end' },
      { column: 'push_tier_milestone', label: 'Resonance tier or integrity weight milestones' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { column: 'push_breaking_news', label: 'Breaking news questions' },
      { column: 'push_sponsored_question', label: 'Sponsored questions' },
      { column: 'push_matching_question', label: 'New questions matching your usual categories' },
    ],
  },
  {
    title: 'Moderation',
    items: [
      { column: 'push_moderation_action', label: 'Your content was flagged or removed' },
    ],
  },
]

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
        {title}
      </div>
      <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, children, border = true }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: border ? '0.5px solid #E5E7EB' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
      <span style={{ fontSize: '14px', color: '#1A1A1A' }}>{label}</span>
      {children}
    </div>
  )
}

export default function NotificationSettings() {
  usePageTitle('Notification Preferences')
  const { user } = useAuth()
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saveMessage, setSaveMessage] = useState(null)

  useEffect(() => {
    if (!user) return

    async function loadPrefs() {
      const { data } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      if (data) {
        setPrefs(data)
      } else {
        // Shouldn't normally happen — migration 075's trigger creates
        // this row the moment a profile does, and backfilled it for
        // every profile that already existed. Kept as a fallback rather
        // than leaving someone stuck on a page that can't render if
        // something upstream of this ever changes.
        const { data: created } = await supabase
          .from('notification_preferences')
          .upsert({ user_id: user.id }, { onConflict: 'user_id' })
          .select('*')
          .single()
        setPrefs(created)
      }
      setLoading(false)
    }

    loadPrefs()
  }, [user])

  async function savePref(column, value) {
    setSaveMessage(null)
    const previous = prefs[column]
    setPrefs(prev => ({ ...prev, [column]: value }))

    const { error } = await supabase
      .from('notification_preferences')
      .update({ [column]: value })
      .eq('user_id', user.id)

    if (error) {
      setPrefs(prev => ({ ...prev, [column]: previous }))
      setSaveMessage('Error saving. Please try again.')
    } else {
      setSaveMessage('Saved!')
      setTimeout(() => setSaveMessage(null), 2000)
    }
  }

  if (loading || !prefs) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100dvh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`, fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div style={{ minHeight: `calc(100dvh - ${HEADER_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px)`, boxSizing: 'border-box', background: '#C7C7CC', paddingBottom: '80px' }}>
    <div style={{ padding: '14px', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', background: '#FFFFFF', borderRadius: 'var(--senseus-card-radius)', boxShadow: 'var(--senseus-card-shadow)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <Link to="/settings" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none' }}>
          ← settings
        </Link>
        <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Notifications</h1>
        <div style={{ width: '48px' }} />
      </div>

      {saveMessage && (
        <div role="status" aria-live="polite" style={{ background: saveMessage === 'Saved!' ? '#eef3e0' : '#f9d8d8', color: saveMessage === 'Saved!' ? '#4d621d' : '#7a1313', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', textAlign: 'center', marginBottom: '1rem' }}>
          {saveMessage}
        </div>
      )}

      <p style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.6, marginBottom: '1.5rem' }}>
        Push notifications aren't available yet — these preferences are saved now so they're ready the moment they launch. Everything here still shows up in your in-app notifications either way.
      </p>

      {GROUPS.map(group => (
        <Section key={group.title} title={group.title}>
          {group.items.map((item, idx) => (
            <Row key={item.column} label={item.label} border={idx < group.items.length - 1}>
              <Toggle
                checked={!!prefs[item.column]}
                onChange={(value) => savePref(item.column, value)}
                label={item.label}
              />
            </Row>
          ))}
        </Section>
      ))}

      <Section title="Security">
        <Row label="Sign-in & account alerts" border={false}>
          <Toggle checked={true} onChange={() => {}} disabled label="Sign-in & account alerts" />
        </Row>
        <div style={{ padding: '0 16px 14px', fontSize: '12px', color: '#9CA3AF', lineHeight: 1.5 }}>
          Always on — these protect your account (new sign-ins, password or email changes) and can't be turned off.
        </div>
      </Section>

    </div>
    </div>
    </div>
  )
}

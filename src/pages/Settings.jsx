import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const ANONYMOUS_NAMES = [
  'Aspen', 'Birch', 'Cedar', 'Echo', 'Fern', 'Harbor', 'Indigo', 'Juniper',
  'Lake', 'Maple', 'Nova', 'Onyx', 'Pine', 'Quill', 'River', 'Sage',
  'Tide', 'Vale', 'Willow', 'Zephyr'
]

const AVATAR_OPTIONS = ['🌿', '🌊', '🔥', '⚡', '🌙', '☀️', '🌱', '🍃', '🦋', '🌸', '🎯', '🧭', '🔮', '🌍', '💡', '🎨', '🏔️', '🌺', '🦅', '✨']

const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' },
  { code: 'BR', name: 'Brazil' },
  { code: 'IN', name: 'India' },
  { code: 'MX', name: 'Mexico' },
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

export default function Settings() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [latestExport, setLatestExport] = useState(null)
  const [exportRequesting, setExportRequesting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showPhoneChange, setShowPhoneChange] = useState(false)
  const [phoneChangeStep, setPhoneChangeStep] = useState('enter') // 'enter' | 'verify'
  const [newPhone, setNewPhone] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [phoneChangeLoading, setPhoneChangeLoading] = useState(false)
  const [phoneChangeError, setPhoneChangeError] = useState(null)
  
  // Sound preference stored in localStorage
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('senseus_sound') !== 'off'
  })

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (!error) setProfile(data)
        setLoading(false)
      })
    supabase
      .from('exports')
      .select('id, status, requested_at, completed_at, download_url, expires_at, error_message')
      .eq('user_id', user.id)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLatestExport(data))
  }, [user])

  function toggleSound() {
    const newVal = !soundEnabled
    setSoundEnabled(newVal)
    localStorage.setItem('senseus_sound', newVal ? 'on' : 'off')
  }

  async function saveProfile(updates) {
    setSaving(true)
    setSaveMessage(null)
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
    if (!error) {
      setProfile(prev => ({ ...prev, ...updates }))
      setSaveMessage('Saved!')
      setTimeout(() => setSaveMessage(null), 2000)
    } else {
      setSaveMessage('Error saving. Please try again.')
    }
    setSaving(false)
  }

function maskPhone(phone) {
    if (!phone) return '—'
    return `•••• ${phone.slice(-4)}`
  }

  async function sendPhoneChangeOtp() {
    if (!newPhone) return
    setPhoneChangeLoading(true)
    setPhoneChangeError(null)
    const { error } = await supabase.auth.updateUser({ phone: newPhone })
    setPhoneChangeLoading(false)
    if (error) {
      setPhoneChangeError(error.message)
      return
    }
    setPhoneChangeStep('verify')
  }

  async function confirmPhoneChange() {
    if (!otpCode) return
    setPhoneChangeLoading(true)
    setPhoneChangeError(null)
    const { error } = await supabase.auth.verifyOtp({
      phone: newPhone,
      token: otpCode,
      type: 'phone_change',
    })
    setPhoneChangeLoading(false)
    if (error) {
      setPhoneChangeError(error.message)
      return
    }
    setShowPhoneChange(false)
    setPhoneChangeStep('enter')
    setNewPhone('')
    setOtpCode('')
    setSaveMessage('Phone number updated!')
    setTimeout(() => setSaveMessage(null), 2000)
  }

  function cancelPhoneChange() {
    setShowPhoneChange(false)
    setPhoneChangeStep('enter')
    setNewPhone('')
    setOtpCode('')
    setPhoneChangeError(null)
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  async function handleDeleteAccount() {
    // For now just sign out — full deletion requires a server-side function
    await signOut()
    navigate('/')
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading...
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <Link to="/profile" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none' }}>
          ← profile
        </Link>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A' }}>Settings</div>
        <div style={{ width: '48px' }} />
      </div>

      {saveMessage && (
        <div style={{ background: saveMessage === 'Saved!' ? '#eef3e0' : '#f9d8d8', color: saveMessage === 'Saved!' ? '#4d621d' : '#7a1313', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', textAlign: 'center', marginBottom: '1rem' }}>
          {saveMessage}
        </div>
      )}

      {/* Experience */}
      <Section title="Experience">
        <Row label="Swipe sound effects">
          <button
            onClick={toggleSound}
            style={{
              width: '44px', height: '24px', borderRadius: '12px',
              background: soundEnabled ? '#2D3DCA' : '#D1D5DB',
              border: 'none', cursor: 'pointer', position: 'relative',
              transition: 'background 0.2s ease', flexShrink: 0,
            }}
          >
            <div style={{
              width: '18px', height: '18px', borderRadius: '50%', background: 'white',
              position: 'absolute', top: '3px',
              left: soundEnabled ? '23px' : '3px',
              transition: 'left 0.2s ease',
            }} />
          </button>
        </Row>
      </Section>

      {/* Identity */}
      <Section title="Identity">
        <Row label="Display name">
          <select
            value={profile?.display_preference || 'full'}
            onChange={(e) => saveProfile({ display_preference: e.target.value })}
            style={{ fontSize: '13px', color: '#1A1A1A', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '4px 8px', fontFamily: 'Merriweather, serif', background: 'white' }}
          >
            <option value="full">First + Last Initial</option>
            <option value="first_only">First name only</option>
            <option value="anon">Anonymous</option>
          </select>
        </Row>
        <Row label="Avatar">
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '200px' }}>
            {AVATAR_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => saveProfile({ avatar: emoji })}
                style={{
                  width: '32px', height: '32px', borderRadius: '50%', border: profile?.avatar === emoji ? '2px solid #2D3DCA' : '2px solid transparent',
                  background: profile?.avatar === emoji ? '#E6F1FB' : 'transparent',
                  cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Bio" border={false}>
          <input
            type="text"
            placeholder="One line about you"
            defaultValue={profile?.bio || ''}
            onBlur={(e) => saveProfile({ bio: e.target.value })}
            maxLength={100}
            style={{ fontSize: '13px', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '6px 8px', fontFamily: 'Merriweather, serif', width: '160px' }}
          />
        </Row>
      </Section>

{/* Account */}
      <Section title="Account">
        {!showPhoneChange ? (
          <>
            <Row label="Phone number">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', color: '#6B7280' }}>{maskPhone(user?.phone)}</span>
                <button
                  onClick={() => setShowPhoneChange(true)}
                  style={{ fontSize: '12px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                >
                  Change
                </button>
              </div>
            </Row>
            <Row label="Recovery email" border={false}>
              <input
                type="email"
                placeholder="optional"
                defaultValue={profile?.recovery_email || ''}
                onBlur={(e) => {
                  const val = e.target.value.trim()
                  if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                    setSaveMessage('Please enter a valid email address.')
                    return
                  }
                  saveProfile({ recovery_email: val || null })
                }}
                maxLength={255}
                style={{ fontSize: '13px', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '6px 8px', fontFamily: 'Merriweather, serif', width: '160px' }}
              />
            </Row>
            <p style={{ fontSize: '11px', color: '#9CA3AF', lineHeight: 1.5, padding: '0 16px 14px', margin: 0 }}>
              Used only if you lose access to your phone number — never for marketing.
            </p>
          </>
        ) : (
          <div style={{ padding: '14px 16px' }}>
            {phoneChangeStep === 'enter' ? (
              <>
                <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '10px', lineHeight: 1.5 }}>
                  Enter your new phone number. We'll text you a code to confirm it's yours.
                </p>
                <div className="senseus-phone-input" style={{ marginBottom: '10px' }}>
                  <PhoneInput
                    defaultCountry={profile?.country_code || 'US'}
                    value={newPhone}
                    onChange={(value) => setNewPhone(value || '')}
                    placeholder="Enter new phone number"
                  />
                </div>
                {phoneChangeError && (
                  <p style={{ fontSize: '12px', color: '#7a1313', marginBottom: '10px' }}>{phoneChangeError}</p>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={sendPhoneChangeOtp}
                    disabled={phoneChangeLoading || !newPhone}
                    style={{ flex: 1, padding: '8px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Merriweather, serif', opacity: (phoneChangeLoading || !newPhone) ? 0.5 : 1 }}
                  >
                    {phoneChangeLoading ? 'Sending...' : 'Send code'}
                  </button>
                  <button
                    onClick={cancelPhoneChange}
                    style={{ flex: 1, padding: '8px', background: '#F3F4F6', color: '#1A1A1A', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '10px', lineHeight: 1.5 }}>
                  Enter the code we texted to your new number.
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  style={{ width: '100%', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', marginBottom: '10px' }}
                />
                {phoneChangeError && (
                  <p style={{ fontSize: '12px', color: '#7a1313', marginBottom: '10px' }}>{phoneChangeError}</p>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={confirmPhoneChange}
                    disabled={phoneChangeLoading || !otpCode}
                    style={{ flex: 1, padding: '8px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Merriweather, serif', opacity: (phoneChangeLoading || !otpCode) ? 0.5 : 1 }}
                  >
                    {phoneChangeLoading ? 'Verifying...' : 'Confirm'}
                  </button>
                  <button
                    onClick={cancelPhoneChange}
                    style={{ flex: 1, padding: '8px', background: '#F3F4F6', color: '#1A1A1A', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Section>

      {/* Location */}
      <Section title="Location">
        <Row label="Country" border={false}>
          <select
            value={profile?.country_code || ''}
            onChange={(e) => saveProfile({ country_code: e.target.value })}
            style={{ fontSize: '13px', color: '#1A1A1A', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '4px 8px', fontFamily: 'Merriweather, serif', background: 'white' }}
          >
            <option value="">Select country</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </Row>
        {profile?.country_code === 'US' && (
          <Row label="Region (optional)" border={false}>
            <select
              value={profile?.region || ''}
              onChange={(e) => saveProfile({ region: e.target.value || null })}
              style={{ fontSize: '13px', color: '#1A1A1A', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '4px 8px', fontFamily: 'Merriweather, serif', background: 'white' }}
            >
              <option value="">Prefer not to say</option>
              <option value="Northeast">Northeast</option>
              <option value="Midwest">Midwest</option>
              <option value="South">South</option>
              <option value="West">West</option>
            </select>
          </Row>
        )}
      </Section>

      {/* Data */}
      <Section title="Your data">
        <Row label="Export my data" border={!!latestExport}>
          {!profile?.recovery_email ? (
            <span style={{ fontSize: '12px', color: '#9CA3AF' }}>
              Add a recovery email above first
            </span>
          ) : (
            <button
              onClick={async () => {
                setExportRequesting(true)
                try {
                  const { error } = await supabase
                    .from('exports')
                    .insert({ user_id: user.id })
                  if (error) throw error
                  setSaveMessage('Export requested! You\'ll receive an email within 48 hours.')
                  setLatestExport({ status: 'pending', requested_at: new Date().toISOString() })
                } catch (err) {
                  setSaveMessage(err.message || 'Error requesting export. Please try again.')
                } finally {
                  setExportRequesting(false)
                }
              }}
              disabled={exportRequesting || latestExport?.status === 'pending' || latestExport?.status === 'processing'}
              style={{
                fontSize: '12px',
                color: '#2D3DCA',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'Merriweather, serif',
                opacity: (exportRequesting || latestExport?.status === 'pending' || latestExport?.status === 'processing') ? 0.5 : 1,
              }}
            >
              {latestExport?.status === 'pending' || latestExport?.status === 'processing'
                ? 'Request in progress...'
                : 'Request export'}
            </button>
          )}
        </Row>
        {latestExport && (
          <div style={{ padding: '10px 16px 14px' }}>
            {latestExport.status === 'completed' && latestExport.download_url && (
              <p style={{ fontSize: '12px', color: '#52B788', margin: 0, lineHeight: 1.6 }}>
                Your export is ready.{' '}
                <a href={latestExport.download_url} style={{ color: '#2D3DCA', fontWeight: 500 }}>
                  Download it
                </a>
                {latestExport.expires_at && (
                  <> (link expires {new Date(latestExport.expires_at).toLocaleDateString()})</>
                )}
              </p>
            )}
            {latestExport.status === 'failed' && (
              <p style={{ fontSize: '12px', color: '#c21f1f', margin: 0, lineHeight: 1.6 }}>
                Your last export request failed. Please try again, or contact privacy@senseus.app if it keeps happening.
              </p>
            )}
          </div>
        )}
        <Row label="Sign out" border={false}>
          <button
            onClick={handleSignOut}
            style={{ fontSize: '12px', color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
          >
            Sign out
          </button>
        </Row>
      </Section>

{/* Support */}
      <Section title="Support senseUS">
        <div style={{ padding: '14px 16px' }}>
          <p style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6, margin: '0 0 10px' }}>
            senseUS is entirely self-funded, with no ads and no selling of your personal data, just your votes.
            If you'd like to help keep it running, or just like pretty pictures, check out lightwillprevail.com —
            proceeds go directly toward running costs, and help keep the light on.
          </p>
          
            <a href="https://lightwillprevail.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '13px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none' }}
          >
            Visit the shop →
          </a>
        </div>
      </Section>

{/* About */}
      <Section title="About senseUS">
        <Row label="How It Works">
          <Link to="/how-it-works" style={{ fontSize: '12px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none' }}>
            View →
          </Link>
        </Row>
        <Row label="Our Mission">
          <Link to="/mission" style={{ fontSize: '12px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none' }}>
            View →
          </Link>
        </Row>
        <Row label="Ethos">
          <Link to="/ethos" style={{ fontSize: '12px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none' }}>
            View →
          </Link>
        </Row>
        <Row label="Transparency Report">
          <Link to="/transparency" style={{ fontSize: '12px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none' }}>
            View →
          </Link>
        </Row>
        <Row label="Privacy Policy">
          <Link to="/privacy" style={{ fontSize: '12px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none' }}>
            View →
          </Link>
        </Row>
        <Row label="Terms of Service" border={false}>
          <Link to="/terms" style={{ fontSize: '12px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none' }}>
            View →
          </Link>
        </Row>
      </Section>

      {/* Danger zone */}
      <Section title="Danger zone">
        {!showDeleteConfirm ? (
          <Row label="Delete account" border={false}>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{ fontSize: '12px', color: '#7a1313', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
            >
              Delete
            </button>
          </Row>
        ) : (
          <div style={{ padding: '14px 16px' }}>
            <p style={{ fontSize: '13px', color: '#7a1313', marginBottom: '12px', lineHeight: 1.5 }}>
              Are you sure? This permanently removes your profile. Your votes are retained anonymously.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleDeleteAccount}
                style={{ flex: 1, padding: '8px', background: '#c21f1f', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
              >
                Yes, delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={{ flex: 1, padding: '8px', background: '#F3F4F6', color: '#1A1A1A', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>

      <div style={{ height: '2rem' }} />

    </div>
  )
}
import PhoneInput from 'react-phone-number-input'
import { usePageTitle } from '../hooks/usePageTitle'
import 'react-phone-number-input/style.css'
import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { checkDisplayText } from '../lib/moderation'
import { HEADER_HEIGHT_PX } from '../components/layout/Header'
import LoadingSpinner from '../components/ui/LoadingSpinner'

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
  usePageTitle('Settings')
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [latestExport, setLatestExport] = useState(null)
  const [exportRequesting, setExportRequesting] = useState(false)
  const [exportDownloading, setExportDownloading] = useState(false)
  const [exportDownloadError, setExportDownloadError] = useState(null)
  const [loading, setLoading] = useState(true)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: user.id, not the user object, is the real dependency (see ProtectedRoute.jsx for the same pattern). AuthContext hands out a new user object reference on every onAuthStateChange firing, including Supabase's routine hourly token refresh.
  }, [user?.id])

  function toggleSound() {
    const newVal = !soundEnabled
    setSoundEnabled(newVal)
    localStorage.setItem('senseus_sound', newVal ? 'on' : 'off')
  }

  async function saveProfile(updates) {
    setSaveMessage(null)

    // Client-side check for immediate feedback — the same field also gets
    // checked server-side by moderate_profile_text() (migration 070), which
    // is the real backstop since this call could otherwise be bypassed by
    // hitting the Supabase API directly. Only checks whichever field is
    // actually part of this particular update, since saveProfile is used
    // for every field on this page (avatar, bio, display preference, etc.),
    // most of which have nothing to do with name/bio text.
    if ('first_name' in updates) {
      const check = checkDisplayText(updates.first_name, 'That name')
      if (!check.allowed) {
        setSaveMessage(check.reason)
        return
      }
    }
    if ('bio' in updates) {
      const check = checkDisplayText(updates.bio, 'That bio')
      if (!check.allowed) {
        setSaveMessage(check.reason)
        return
      }
    }

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
    const { error } = await supabase
      .from('profiles')
      .update({ deletion_requested_at: new Date().toISOString() })
      .eq('id', user.id)

    if (error) {
      alert('Something went wrong: ' + error.message)
      return
    }

    setProfile(prev => ({ ...prev, deletion_requested_at: new Date().toISOString() }))
    setShowDeleteConfirm(false)
  }

  async function handleCancelDeletion() {
    const { error } = await supabase
      .from('profiles')
      .update({ deletion_requested_at: null })
      .eq('id', user.id)

    if (error) {
      alert('Something went wrong: ' + error.message)
      return
    }

    setProfile(prev => ({ ...prev, deletion_requested_at: null }))
  }

  // A plain <a href> to a Supabase Storage signed URL just navigates the
  // browser there — for a .json file with no Content-Disposition header
  // that means it opens inline in the tab rather than downloading, and
  // the `download` attribute is silently ignored by browsers for
  // cross-origin links like this one. Fetching it ourselves and handing
  // the bytes back as a same-origin blob URL is what actually makes the
  // browser download a named file. It also means we find out here,
  // directly, if the signed link has actually expired (a 400 from
  // Supabase Storage) instead of only failing silently on click.
  async function handleDownloadExport(url) {
    setExportDownloadError(null)
    setExportDownloading(true)
    try {
      const res = await fetch(url)
      if (!res.ok) {
        setExportDownloadError('This export link has expired. Request a new export below.')
        return
      }
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `senseus-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(blobUrl)
    } catch {
      setExportDownloadError('Could not download your export. Please try again.')
    } finally {
      setExportDownloading(false)
    }
  }

  const exportExpired = !!(latestExport?.expires_at && new Date(latestExport.expires_at) < new Date())

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: `calc(100dvh - ${HEADER_HEIGHT_PX}px)`, fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', boxSizing: 'border-box', background: '#C7C7CC', paddingBottom: '80px' }}>
    <div style={{ padding: '14px', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', background: '#FFFFFF', borderRadius: 'var(--senseus-card-radius)', boxShadow: 'var(--senseus-card-shadow)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <Link to="/profile" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none' }}>
          ← profile
        </Link>
        <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', margin: 0 }}>Settings</h1>
        <div style={{ width: '48px' }} />
      </div>

      {saveMessage && (
        <div role="status" aria-live="polite" style={{ background: saveMessage === 'Saved!' ? '#eef3e0' : '#f9d8d8', color: saveMessage === 'Saved!' ? '#4d621d' : '#7a1313', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', textAlign: 'center', marginBottom: '1rem' }}>
          {saveMessage}
        </div>
      )}

      {/* Experience */}
      <Section title="Experience">
        <Row label="Swipe sound effects">
          <button
            onClick={toggleSound}
            role="switch"
            aria-checked={soundEnabled}
            aria-label="Swipe sound effects"
            style={{
              width: '44px', height: '24px', borderRadius: '12px',
              background: soundEnabled ? '#2D3DCA' : '#D1D5DB',
              border: 'none', cursor: 'pointer', position: 'relative',
              transition: 'background 0.2s ease', flexShrink: 0,
            }}
          >
            <div aria-hidden="true" style={{
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
        {/* First name / last initial — kept editable regardless of the
            current display preference below, not just when it's 'full' or
            'first_only'. Registering as Anonymous never asks for a name at
            all (see Register.jsx), so first_name is saved as an empty
            string; someone who starts anonymous and later switches their
            display preference had no way to go back and actually set a
            name — these two fields are that missing path. */}
        <Row label="First name">
          <input
            type="text"
            placeholder="Not set"
            aria-label="First name"
            defaultValue={profile?.first_name || ''}
            onBlur={(e) => saveProfile({ first_name: e.target.value.trim() })}
            maxLength={50}
            style={{ fontSize: '13px', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '6px 8px', fontFamily: 'Merriweather, serif', width: '140px' }}
          />
        </Row>
        <Row label="Last initial">
          <input
            type="text"
            placeholder="Not set"
            aria-label="Last initial"
            defaultValue={profile?.last_initial || ''}
            onBlur={(e) => saveProfile({ last_initial: e.target.value.trim().charAt(0).toUpperCase() || null })}
            maxLength={1}
            style={{ fontSize: '13px', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '6px 8px', fontFamily: 'Merriweather, serif', width: '40px', textAlign: 'center' }}
          />
        </Row>
        <Row label="Display name">
          <select
            value={profile?.display_preference || 'full'}
            onChange={(e) => saveProfile({ display_preference: e.target.value })}
            aria-label="Display name"
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
                aria-label={`Select ${emoji} as your avatar`}
                aria-pressed={profile?.avatar === emoji}
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
            aria-label="Bio"
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
                  aria-label="Change phone number"
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
                aria-label="Recovery email"
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
            <p style={{ fontSize: '11px', color: '#6B7280', lineHeight: 1.5, padding: '0 16px 14px', margin: 0 }}>
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
                    aria-label="New phone number"
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
                  aria-label="Verification code"
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
            <span style={{ fontSize: '12px', color: '#6B7280' }}>
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
            {latestExport.status === 'completed' && latestExport.download_url && !exportExpired && (
              <p style={{ fontSize: '12px', color: '#52B788', margin: 0, lineHeight: 1.6 }}>
                Your export is ready.{' '}
                <button
                  onClick={() => handleDownloadExport(latestExport.download_url)}
                  disabled={exportDownloading}
                  style={{ fontSize: '12px', color: '#2D3DCA', fontWeight: 500, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'Merriweather, serif', opacity: exportDownloading ? 0.6 : 1 }}
                >
                  {exportDownloading ? 'Downloading...' : 'Download it'}
                </button>
                {latestExport.expires_at && (
                  <> (link expires {new Date(latestExport.expires_at).toLocaleDateString()})</>
                )}
                {exportDownloadError && (
                  <><br /><span style={{ color: '#c21f1f' }}>{exportDownloadError}</span></>
                )}
              </p>
            )}
            {latestExport.status === 'completed' && latestExport.download_url && exportExpired && (
              <p style={{ fontSize: '12px', color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
                Your export link expired {new Date(latestExport.expires_at).toLocaleDateString()}. Request a new export above to get a fresh link.
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
        {profile?.deletion_requested_at ? (
          <div style={{ padding: '14px 16px' }}>
            <p style={{ fontSize: '13px', color: '#7a1313', marginBottom: '12px', lineHeight: 1.5 }}>
              Your account is scheduled for deletion on{' '}
              {new Date(new Date(profile.deletion_requested_at).getTime() + 48 * 60 * 60 * 1000).toLocaleString()}.
              You can still cancel this until then.
            </p>
            <button
              onClick={handleCancelDeletion}
              style={{ width: '100%', padding: '8px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
            >
              Cancel deletion
            </button>
          </div>
        ) : !showDeleteConfirm ? (
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
              Are you sure? This permanently deletes your profile, votes, comments, and everything tied to your account — nothing is retained. You'll have 48 hours to change your mind before this becomes final.
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
    </div>
    </div>
  )
}
import Header from '../components/layout/Header'
import AnimatedWordmark from '../components/layout/AnimatedWordmark'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRegistration } from '../hooks/useRegistration'
import PhoneInput from 'react-phone-number-input'
import { getExampleNumber } from 'libphonenumber-js'
import examples from 'libphonenumber-js/examples.mobile.json'
import 'react-phone-number-input/style.css'
import { Link } from 'react-router-dom'
import OnboardingAnimation from '../components/ui/OnboardingAnimation'

// Auto-detects a default country from the browser's locale (e.g. "en-US" -> "US").
// Falls back to "US" if the locale doesn't include a region, since that's the
// most common case for senseUS's initial audience.
function getDefaultCountryFromLocale() {
  try {
    const locale = navigator.language || navigator.languages?.[0] || 'en-US'
    const parts = locale.split('-')
    const region = parts[1]
    return region ? region.toUpperCase() : 'US'
  } catch {
    return 'US'
  }
}

// Generates a real, correctly-formatted example number for the given country
// (e.g. "(201) 555-0123" for US) to use as a light-grey format hint in the input.
function getPlaceholderForCountry(countryCode) {
  try {
    const example = getExampleNumber(countryCode, examples)
    return example ? example.formatNational() : undefined
  } catch {
    return undefined
  }
}

export default function Register() {
  const {
    phone, setPhone,
    code, setCode,
    step,
    loading, error,
    sendCode, checkCode, completeRegistration,
    redirectTo,
  } = useRegistration()

  const [birthYear, setBirthYear] = useState('')
  const [isOver18, setIsOver18] = useState(false)
  const [dataConsent, setDataConsent] = useState(false)
  const [displayPreference, setDisplayPreference] = useState('full')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [country, setCountry] = useState('')
  const [defaultPhoneCountry] = useState(getDefaultCountryFromLocale)
  const [phoneCountry, setPhoneCountry] = useState(defaultPhoneCountry)

  const currentYear = new Date().getFullYear()
  const meetsAgeRequirement = birthYear && (currentYear - parseInt(birthYear, 10)) >= 18
  const [showOnboarding, setShowOnboarding] = useState(true)
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [checkingStatus, setCheckingStatus] = useState(true)

  useEffect(() => {
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'registration_open')
      .single()
      .then(({ data }) => {
        setRegistrationOpen(data?.value !== false)
        setCheckingStatus(false)
      })
  }, [])

if (checkingStatus) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        Loading...
      </div>
    )
  }

  if (!registrationOpen) {
    return (
      <div style={{ maxWidth: '420px', margin: '0 auto', padding: '2rem 1.5rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
          Registration is temporarily closed
        </h1>
        <p style={{ fontSize: '14px', color: '#6B7280', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          We're not accepting new accounts right now. Check back soon, or join the waitlist to be notified when we reopen.
        </p>
        <Link
          to="/"
          style={{ display: 'inline-block', padding: '10px 20px', background: '#2D3DCA', color: 'white', borderRadius: '8px', fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}
        >
          Back to home
        </Link>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '420px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      <img
        src="/senseUS-logo.png"
        alt="senseUS"
        style={{ height: '56px', width: 'auto', marginBottom: '8px' }}
      />
      <div style={{ fontSize: '28px', fontWeight: 400, color: '#1A1A1A', marginBottom: '4px' }}>
        sense<AnimatedWordmark />
      </div>
      <h1 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '1.5rem', color: '#2D3DCA' }}>
        Join senseUS
      </h1>

      {error && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f9d8d8', color: '#7a1313', borderRadius: '8px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {step === 'phone' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500 }}>
            Phone number
            <div className="senseus-phone-input" style={{ marginTop: '6px' }}>
              <PhoneInput
                defaultCountry={defaultPhoneCountry}
                value={phone}
                onChange={(value) => setPhone(value || '')}
                onCountryChange={(c) => setPhoneCountry(c || defaultPhoneCountry)}
                placeholder={getPlaceholderForCountry(phoneCountry)}
                autoComplete="tel"
              />
            </div>
          </label>
          <button
            onClick={sendCode}
            disabled={loading || !phone}
            style={{ width: '100%', padding: '11px', borderRadius: '8px', background: '#2D3DCA', color: 'white', border: 'none', fontSize: '14px', fontWeight: 500, cursor: 'pointer', opacity: (loading || !isOver18 || !dataConsent || (displayPreference !== 'anon' && !firstName) || !country) ? 0.5 : 1 }}
          >
            {loading ? 'Sending...' : 'Send verification code'}
          </button>
          <div style={{ background: '#E6F1FB', border: '1px solid #0C447C', borderRadius: '8px', padding: '10px 12px', marginTop: '4px' }}>
            <p style={{ fontSize: '12px', color: '#0C447C', margin: '0', lineHeight: 1.6, textAlign: 'center' }}>
              By entering your phone number and clicking "Send verification code," you consent to receive a one-time SMS verification code from senseUS (operated by Gudboi Enterprises, LLC). Message and data rates may apply. You will not receive marketing messages.
              <a href="/privacy" style={{ color: '#2D3DCA', textDecoration: 'none', fontWeight: 500 }}>Privacy Policy</a>
              {' '}·{' '}
              <a href="/terms" style={{ color: '#2D3DCA', textDecoration: 'none', fontWeight: 500 }}>Terms of Service</a>
            </p>
          </div>
        </div>
      )}

      {step === 'code' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500 }}>
            Enter the 6-digit code
            <input
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box' }}
            />
          </label>
          <button
            onClick={checkCode}
            disabled={loading || !code}
            style={{ width: '100%', padding: '11px', borderRadius: '8px', background: '#2D3DCA', color: 'white', border: 'none', fontSize: '14px', fontWeight: 500, cursor: 'pointer', opacity: loading || !code ? 0.5 : 1 }}
          >
            {loading ? 'Verifying...' : 'Verify code'}
          </button>
        </div>
      )}

      {step === 'details' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500 }}>
            Birth year
            <input
              type="number"
              placeholder="1990"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box' }}
            />
          </label>

          {birthYear && !meetsAgeRequirement && (
            <p style={{ color: '#7a1313', fontSize: '13px', margin: 0 }}>
              You must be 18 or older to use senseUS.
            </p>
          )}

          {meetsAgeRequirement && (
            <>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', lineHeight: 1.6 }}>
                <input
                  type="checkbox"
                  checked={isOver18}
                  onChange={(e) => setIsOver18(e.target.checked)}
                  style={{ marginTop: '4px', flexShrink: 0 }}
                />
                <span>
                  By selecting this box, I confirm I am a real human being who wants to be a meaningful participant in Humankind. I also confirm that I am 18 years of age or older, and agree to the{' '}
                  <a href="/terms" style={{ color: '#2D3DCA', textDecoration: 'none' }}>Terms of Service</a>
                  {' '}and{' '}
                  <a href="/privacy" style={{ color: '#2D3DCA', textDecoration: 'none' }}>Privacy Policy</a>.
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '13px', lineHeight: 1.6 }}>
                <input
                  type="checkbox"
                  checked={dataConsent}
                  onChange={(e) => setDataConsent(e.target.checked)}
                  style={{ marginTop: '4px', flexShrink: 0 }}
                />
                <span>
                  I understand that my votes will be included anonymously in aggregate data. My individual responses will never be identified or attributed to me.
                </span>
              </label>

              <p style={{ fontSize: '12px', color: '#52B788', textAlign: 'center', lineHeight: 1.6, margin: '0' }}>
                Just your vote. Not your name. Not anything that can be traced back to you.
              </p>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>How should your name appear?</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                    <input type="radio" checked={displayPreference === 'full'} onChange={() => setDisplayPreference('full')} />
                    First name + last initial (e.g. Mary K.)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                    <input type="radio" checked={displayPreference === 'first_only'} onChange={() => setDisplayPreference('first_only')} />
                    First name only
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                    <input type="radio" checked={displayPreference === 'anon'} onChange={() => setDisplayPreference('anon')} />
                    Anonymous (random name assigned)
                  </label>
                </div>
              </div>

              {(displayPreference === 'full' || displayPreference === 'first_only') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500 }}>
                    First name
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box' }}
                    />
                  </label>
                  {displayPreference === 'full' && (
                    <label style={{ fontSize: '13px', fontWeight: 500 }}>
                      Last name
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box' }}
                      />
                    </label>
                  )}
                </div>
              )}
<label style={{ fontSize: '13px', fontWeight: 500 }}>
                Country of residence
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
                >
                  <option value="">Select your country...</option>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option>
                  <option value="AU">Australia</option>
                  <option value="DE">Germany</option>
                  <option value="FR">France</option>
                  <option value="JP">Japan</option>
                  <option value="BR">Brazil</option>
                  <option value="IN">India</option>
                  <option value="MX">Mexico</option>
                  <option value="ZA">South Africa</option>
                  <option value="NG">Nigeria</option>
                  <option value="KE">Kenya</option>
                  <option value="EG">Egypt</option>
                  <option value="AR">Argentina</option>
                  <option value="CL">Chile</option>
                  <option value="CO">Colombia</option>
                  <option value="ES">Spain</option>
                  <option value="IT">Italy</option>
                  <option value="NL">Netherlands</option>
                  <option value="SE">Sweden</option>
                  <option value="NO">Norway</option>
                  <option value="DK">Denmark</option>
                  <option value="FI">Finland</option>
                  <option value="PL">Poland</option>
                  <option value="PT">Portugal</option>
                  <option value="NZ">New Zealand</option>
                  <option value="SG">Singapore</option>
                  <option value="KR">South Korea</option>
                  <option value="PH">Philippines</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>

              <p style={{ fontSize: '12px', color: '#52B788', textAlign: 'center', lineHeight: 1.6, margin: '0' }}>
                Just your vote. Not your name. Not anything that can be traced back to you.
              </p>

              <button
                onClick={() => completeRegistration({
                  birthYear: parseInt(birthYear, 10),
                  displayPreference,
                  firstName,
                  lastName,
                  country,
                })}
                disabled={loading || !isOver18 || !dataConsent || (displayPreference !== 'anon' && !firstName) || !country}
                style={{ width: '100%', padding: '11px', borderRadius: '8px', background: '#52B788', color: 'white', border: 'none', fontSize: '14px', fontWeight: 500, cursor: 'pointer', opacity: (loading || !isOver18 || !dataConsent || (displayPreference !== 'anon' && !firstName)) ? 0.5 : 1 }}
              >
                {loading ? 'Creating account...' : 'Complete registration'}
              </button>
            </>
          )}
        </div>
      )}

      {step === 'done' && !showOnboarding && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '20px', fontWeight: 600, color: '#52B788', marginBottom: '8px' }}>
            Welcome to senseUS!
          </p>
          <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '1.5rem' }}>Your account has been created.</p>
          <button
            onClick={() => setShowOnboarding(true)}
            style={{
              display: 'block',
              width: '100%',
              padding: '12px',
              background: '#2D3DCA',
              color: 'white',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'Merriweather, serif',
              textAlign: 'center',
              boxSizing: 'border-box',
            }}
          >
            {redirectTo ? 'Go vote on this question' : 'Start voting'}
          </button>
        </div>
      )}

      {showOnboarding && (
        <OnboardingAnimation
          onComplete={() => {
            setShowOnboarding(false)
            window.location.href = redirectTo || '/vote'
          }}
        />
      )}
          </div>
  )
}
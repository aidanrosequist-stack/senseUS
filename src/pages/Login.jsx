import { sendOtpCode, verifyOtpCode } from '../lib/otpAuth'
import TurnstileWidget from '../components/ui/TurnstileWidget'
import { useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import PhoneInput from 'react-phone-number-input'
import { getExampleNumber } from 'libphonenumber-js'
import examples from 'libphonenumber-js/examples.mobile.json'
import 'react-phone-number-input/style.css'
import { usePageTitle } from '../hooks/usePageTitle'

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

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

export default function Login() {
  usePageTitle('Log In')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [defaultPhoneCountry] = useState(getDefaultCountryFromLocale)
  const [phoneCountry, setPhoneCountry] = useState(getDefaultCountryFromLocale())
  const [turnstileToken, setTurnstileToken] = useState(null)
  const turnstileRef = useRef(null)

  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from || '/vote'

  async function sendCode() {
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError('Please complete the verification check above.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { error: otpError } = await sendOtpCode(phone, turnstileToken)
      if (otpError) {
        setError(otpError.message)
        turnstileRef.current?.reset()
        setTurnstileToken(null)
      } else {
        setStep('code')
      }
    } catch (err) {
      setError(err.message)
      turnstileRef.current?.reset()
      setTurnstileToken(null)
    } finally {
      setLoading(false)
    }
  }

  async function verifyCode() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: verifyError } = await verifyOtpCode(phone, code)
      if (verifyError || !data.session) {
        setError(verifyError?.message || 'Incorrect code. Please try again.')
      } else {
        navigate(from, { replace: true })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '420px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '2rem' }}>
        <Link to="/" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none' }}>
          ← back
        </Link>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <img
          src="/senseUS-logo.png"
          alt="senseUS"
          style={{ height: '56px', width: 'auto', marginBottom: '8px' }}
        />
        <div style={{ fontSize: '28px', fontWeight: 400, color: '#1A1A1A', marginBottom: '4px' }}>
          sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
        </div>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1A1A1A', margin: 0 }}>
          Welcome back
        </h1>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f9d8d8', color: '#7a1313', borderRadius: '8px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {step === 'phone' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Phone number
            <div className="senseus-phone-input" style={{ marginTop: '6px' }}>
              <PhoneInput
                defaultCountry={defaultPhoneCountry}
                value={phone}
                onChange={(value) => setPhone(value || '')}
                onCountryChange={(c) => setPhoneCountry(c || defaultPhoneCountry)}
                placeholder={getExampleNumber(phoneCountry, examples)?.formatNational()}
                autoComplete="tel"
              />
            </div>
          </label>
          {TURNSTILE_SITE_KEY && (
            <TurnstileWidget
              ref={turnstileRef}
              siteKey={TURNSTILE_SITE_KEY}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
              onError={() => setTurnstileToken(null)}
            />
          )}
          <button
            onClick={sendCode}
            disabled={loading || !phone || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
            style={{ width: '100%', padding: '11px', borderRadius: '8px', background: '#2D3DCA', color: 'white', border: 'none', fontSize: '14px', fontWeight: 700, cursor: 'pointer', opacity: loading || !phone ? 0.5 : 1, fontFamily: 'Merriweather, serif' }}
          >
            {loading ? 'Sending...' : 'Send verification code'}
          </button>
          <p style={{ fontSize: '11px', color: '#6B7280', margin: 0, lineHeight: 1.5, textAlign: 'center' }}>
            Don't have an account?{' '}
            <Link to="/register" style={{ color: '#2D3DCA', textDecoration: 'none' }}>Sign up here</Link>
          </p>
        </div>
      )}

      {step === 'code' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Enter the 6-digit code
            <input
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
            />
          </label>
          <button
            onClick={verifyCode}
            disabled={loading || !code}
            style={{ width: '100%', padding: '11px', borderRadius: '8px', background: '#2D3DCA', color: 'white', border: 'none', fontSize: '14px', fontWeight: 700, cursor: 'pointer', opacity: loading || !code ? 0.5 : 1, fontFamily: 'Merriweather, serif' }}
          >
            {loading ? 'Verifying...' : 'Log in'}
          </button>
          <button
            onClick={() => { setStep('phone'); setCode(''); setError(null); }}
            style={{ width: '100%', padding: '11px', borderRadius: '8px', background: 'transparent', color: '#6B7280', border: '1px solid #D1D5DB', fontSize: '13px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
          >
            Use a different number
          </button>
        </div>
      )}

    </div>
  )
}
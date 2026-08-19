import { sendOtpCode, verifyOtpCode } from '../lib/otpAuth'
import { supabase } from '../lib/supabase'
import { useState, useEffect } from 'react'

const ANONYMOUS_NAMES = [
  'Alex R.', 'Jordan M.', 'Casey T.', 'Morgan B.', 'Riley S.',
  'Sam P.', 'Taylor W.', 'Quinn A.', 'Drew H.', 'Blake N.',
  'Avery K.', 'Rowan L.', 'Sage D.', 'River C.', 'Phoenix J.',
  'Amara T.', 'Rohan B.', 'Lena W.', 'Mateo R.', 'Kai M.'
]
export function useRegistration() {
  const [phone, setPhone] = useState('')
  const [redirectTo, setRedirectTo] = useState(null)
  const [code, setCode] = useState('')
  const [step, setStep] = useState('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

useEffect(() => {
    async function checkExistingSession() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()
      if (!profile) {
        if (user.phone) setPhone(`+${user.phone}`)
        setStep('details')
      }
    }
    checkExistingSession()
  }, [])

  async function sendCode(captchaToken) {
    setLoading(true)
    setError(null)
    try {
      const { error: otpError } = await sendOtpCode(phone, captchaToken)
      if (otpError) {
        setError(otpError.message)
        return false
      } else {
        setStep('code')
        return true
      }
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setLoading(false)
    }
  }

  async function checkCode() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: verifyError } = await verifyOtpCode(phone, code)
      if (verifyError || !data.session) {
        setError(verifyError?.message || 'Incorrect code. Please try again.')
      } else {
        // Fire-and-forget — never blocks registration on Lookup latency
        // or failure. See check-line-type/index.ts and migration
        // 010_voip_weight_withholding.sql for what this does.
        supabase.functions.invoke('check-line-type', { body: { phone } }).catch(() => {
          // Silent fail — this is a defense-in-depth signal, not a
          // requirement for registration to succeed.
        })
        setStep('details')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function completeRegistration({ birthYear, displayPreference, firstName, lastName, country }) {
    setLoading(true)
    setError(null)
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) {
        setError('Session not found. Please verify your phone again.')
        return
      }

      let lastInitial = null
      let anonName = null

      if (displayPreference === 'full') {
        lastInitial = lastName ? lastName.charAt(0).toUpperCase() : null
      } else if (displayPreference === 'anon') {
        const base = ANONYMOUS_NAMES[Math.floor(Math.random() * ANONYMOUS_NAMES.length)]
        const suffix = Math.floor(Math.random() * 90) + 10
        anonName = `${base} ${suffix}`
      }

      const { error: insertError } = await supabase.from('profiles').upsert({
        id: userData.user.id,
        first_name: firstName,
        last_initial: lastInitial,
        display_preference: displayPreference,
        anon_name: anonName,
        birth_year: birthYear,
        country_code: country,
      })

      if (insertError) {
        setError(insertError.message)
        return
      }

      // Remove from waitlist if they pre-signed up — fire-and-forget,
      // same as the welcome SMS below. This is cleanup, not a
      // requirement for registration to succeed.
      Promise.resolve(supabase.from('waitlist').delete().eq('phone', phone)).catch(() => {
        // Silent fail
      })

      // Send welcome SMS — fire and forget, don't block registration completion
      supabase.functions.invoke('send-welcome-sms', {
        body: { phone }
      }).catch(() => {
        // Silent fail — welcome SMS failure shouldn't break registration
      })

      // Check if user came from a shared comment link
      const params = new URLSearchParams(window.location.search)
      const fromQ = params.get('from') === 'q'
      const questionNumber = params.get('q')
      if (fromQ && questionNumber) {
        setRedirectTo(`/q/${questionNumber}`)
      }

      setStep('done')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return {
    phone, setPhone,
    code, setCode,
    step, setStep,
    loading, error,
    sendCode, checkCode, completeRegistration,
    redirectTo,
  }
}
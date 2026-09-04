import { sendOtpCode, verifyOtpCode } from '../lib/otpAuth'
import { supabase } from '../lib/supabase'
import { checkDisplayText } from '../lib/moderation'
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
    // Checked here rather than only relying on the database trigger
    // (moderate_profile_text(), migration 070) so a bad name fails with a
    // friendly inline message instead of a raw Postgres error surfacing
    // after a round trip. The DB trigger stays the real backstop — this is
    // reachable even while Anonymous is selected (first_name is still
    // stored either way, just not displayed), so a name typed in and then
    // hidden behind Anonymous doesn't sneak past unchecked.
    const nameCheck = checkDisplayText(firstName, 'That name')
    if (!nameCheck.allowed) {
      setError(nameCheck.reason)
      return
    }

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

      // Send welcome SMS — fire and forget, don't block registration completion.
      // Sourced from userData.user.phone (already fetched above, and always
      // populated for a phone-OTP-verified session) rather than the `phone`
      // component state. State is normally populated by the phone-entry step,
      // but on a resumed session (verify, close the tab, come back later)
      // it depends on checkExistingSession() having already set it — reading
      // straight off the auth session removes that dependency instead of
      // just patching the one path that was missing it.
      const smsPhone = userData.user.phone ? `+${userData.user.phone}` : phone
      supabase.functions.invoke('send-welcome-sms', {
        body: { phone: smsPhone }
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
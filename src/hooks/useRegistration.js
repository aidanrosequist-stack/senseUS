import { useState } from 'react'
import { supabase } from '../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

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

  async function sendCode() {
    setLoading(true)
    setError(null)
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone })
      if (otpError) {
        setError(otpError.message)
      } else {
        setStep('code')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function checkCode() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: code,
        type: 'sms',
      })
      if (verifyError || !data.session) {
        setError(verifyError?.message || 'Incorrect code. Please try again.')
      } else {
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
        anonName = ANONYMOUS_NAMES[Math.floor(Math.random() * ANONYMOUS_NAMES.length)]
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

       // Remove from waitlist if they pre-signed up
      await supabase.from('waitlist').delete().eq('phone', phone)

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
import { useState } from 'react'
import { supabase } from '../lib/supabase'

const ANONYMOUS_NAMES = [
  'Aspen', 'Birch', 'Cedar', 'Echo', 'Fern', 'Harbor', 'Indigo', 'Juniper',
  'Lake', 'Maple', 'Nova', 'Onyx', 'Pine', 'Quill', 'River', 'Sage',
  'Tide', 'Vale', 'Willow', 'Zephyr'
]

export function useRegistration() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('phone') // phone -> code -> details -> done
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

  async function completeRegistration({ birthYear, displayNameType, firstName, lastName }) {
    setLoading(true)
    setError(null)
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) {
        setError('Session not found. Please verify your phone again.')
        return
      }

      let displayName = ''
      let anonymousColor = null

      if (displayNameType === 'first_last') {
        displayName = `${firstName} ${lastName.charAt(0)}.`
      } else if (displayNameType === 'first_only') {
        displayName = firstName
      } else if (displayNameType === 'anonymous') {
        displayName = ANONYMOUS_NAMES[Math.floor(Math.random() * ANONYMOUS_NAMES.length)]
        anonymousColor = '#52B788'
      }

      const { error: insertError } = await supabase.from('users').insert({
        id: userData.user.id,
        phone,
        birth_year: birthYear,
        display_name_type: displayNameType,
        display_name: displayName,
        anonymous_color: anonymousColor,
        is_verified: true,
      })
      if (insertError) {
        setError(insertError.message)
        return
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
  }
}
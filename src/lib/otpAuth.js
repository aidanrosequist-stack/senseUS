import { supabase } from './supabase'

// Single source of truth for the two actual Supabase Auth calls used by
// both Login.jsx and useRegistration.js. Before this existed, each file
// had its own near-identical copy that had already started to drift
// (Login always passed a captchaToken option, even null; useRegistration
// only included it when a real token existed) — a bug fix to one path
// wasn't guaranteed to reach the other. Each caller still owns its own
// phone/code/turnstile state; this only unifies the actual API calls.

export async function sendOtpCode(phone, captchaToken) {
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: captchaToken ? { captchaToken } : undefined,
  })
  return { error }
}

export async function verifyOtpCode(phone, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  })
  return { data, error }
}

import { parsePhoneNumber } from 'libphonenumber-js'

// Countries senseUS is open to (Aidan, 2026-11-18): US, Canada, the UK,
// Australia, New Zealand, the 27 EU members, plus Norway, Switzerland,
// Iceland and Liechtenstein. Used for both the country of residence
// (sign-up and Settings) and the sign-up phone number's country.
//
// Keep in sync with the allowed_country_codes CHECK in migration 113
// (profiles.country_code). Adding a country means updating both.
//
// The real gate on phone numbers is Twilio's Geo Permissions (it simply
// won't send a code elsewhere); the checks here exist so people get a
// clear message instead of a code that never arrives.

export const MAIN_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
]

export const EUROPEAN_COUNTRIES = [
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'HR', name: 'Croatia' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EE', name: 'Estonia' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'GR', name: 'Greece' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IS', name: 'Iceland' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IT', name: 'Italy' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MT', name: 'Malta' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'ES', name: 'Spain' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
]

export const ALLOWED_COUNTRIES = [...MAIN_COUNTRIES, ...EUROPEAN_COUNTRIES]

export const ALLOWED_COUNTRY_CODES = ALLOWED_COUNTRIES.map(c => c.code)

const ALLOWED_SET = new Set(ALLOWED_COUNTRY_CODES)

export function isAllowedCountry(code) {
  return ALLOWED_SET.has(code)
}

export function countryName(code) {
  const listed = ALLOWED_COUNTRIES.find(c => c.code === code)?.name
  if (listed) return listed
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}

// Territories that share a dialing code with an allowed country. Their
// numbers count as the parent country's: many ordinary UK mobile numbers,
// for instance, resolve to Guernsey, Jersey or the Isle of Man, and US
// territories have their own +1 area codes. Mirrored in the database by
// phone_number_country() (migration 114); keep the two in sync.
const SHARED_CODE_TERRITORIES = {
  PR: 'US', VI: 'US', GU: 'US', MP: 'US', AS: 'US', // +1
  GG: 'GB', JE: 'GB', IM: 'GB', // +44
  AX: 'FI', // +358
  SJ: 'NO', // +47
  VA: 'IT', // +39
  CX: 'AU', CC: 'AU', // +61
}

// Country a full international number (e.g. "+447911123456") belongs to,
// or null if it can't be parsed. Shared +1 numbers resolve by area code,
// so Canadian and Caribbean numbers aren't mistaken for US ones. A number
// that doesn't match any known range falls back to its dialing code's
// main country; it is left to Twilio to reject if it's not a real number.
export function phoneNumberCountry(phone) {
  try {
    const parsed = parsePhoneNumber(phone)
    const country = parsed?.country || parsed?.getPossibleCountries?.()[0] || null
    return SHARED_CODE_TERRITORIES[country] || country
  } catch {
    return null
  }
}

export const NOT_AVAILABLE_MESSAGE =
  'senseUS is currently open to phone numbers from the US, Canada, the UK, Australia, New Zealand and Europe. We hope to welcome more countries soon.'

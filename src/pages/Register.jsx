import { useState } from 'react'
import { useRegistration } from '../hooks/useRegistration'

export default function Register() {
  const {
    phone, setPhone,
    code, setCode,
    step,
    loading, error,
    sendCode, checkCode, completeRegistration,
  } = useRegistration()

  const [birthYear, setBirthYear] = useState('')
  const [isOver18, setIsOver18] = useState(false)
  const [displayNameType, setDisplayNameType] = useState('first_last')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')

  const currentYear = new Date().getFullYear()
  const meetsAgeRequirement = birthYear && (currentYear - parseInt(birthYear, 10)) >= 18

  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6" style={{ color: '#2D3DCA' }}>
        Join senseUS
      </h1>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>
      )}

      {step === 'phone' && (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Phone number</span>
            <input
              type="tel"
              placeholder="+15551234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 block w-full border rounded p-2"
            />
          </label>
          <button
            onClick={sendCode}
            disabled={loading || !phone}
            className="w-full py-2 rounded text-white font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2D3DCA' }}
          >
            {loading ? 'Sending...' : 'Send verification code'}
          </button>
        </div>
      )}

      {step === 'code' && (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Enter the 6-digit code</span>
            <input
              type="text"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 block w-full border rounded p-2"
            />
          </label>
          <button
            onClick={checkCode}
            disabled={loading || !code}
            className="w-full py-2 rounded text-white font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2D3DCA' }}
          >
            {loading ? 'Verifying...' : 'Verify code'}
          </button>
        </div>
      )}

      {step === 'details' && (
        <div className="space-y-5">
          <label className="block">
            <span className="text-sm font-medium">Birth year</span>
            <input
              type="number"
              placeholder="1990"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              className="mt-1 block w-full border rounded p-2"
            />
          </label>

          {birthYear && !meetsAgeRequirement && (
            <p className="text-red-600 text-sm">
              You must be 18 or older to use senseUS.
            </p>
          )}

          {meetsAgeRequirement && (
            <>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isOver18}
                  onChange={(e) => setIsOver18(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm">I confirm I am 18 years of age or older.</span>
              </label>

              <div>
                <span className="text-sm font-medium block mb-2">How should your name appear?</span>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={displayNameType === 'first_last'}
                      onChange={() => setDisplayNameType('first_last')}
                    />
                    <span className="text-sm">First name + last initial</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={displayNameType === 'first_only'}
                      onChange={() => setDisplayNameType('first_only')}
                    />
                    <span className="text-sm">First name only</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={displayNameType === 'anonymous'}
                      onChange={() => setDisplayNameType('anonymous')}
                    />
                    <span className="text-sm">Anonymous (random name assigned)</span>
                  </label>
                </div>
              </div>

              {(displayNameType === 'first_last' || displayNameType === 'first_only') && (
                <div className="space-y-3">
                  <label className="block">
                    <span className="text-sm font-medium">First name</span>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="mt-1 block w-full border rounded p-2"
                    />
                  </label>
                  {displayNameType === 'first_last' && (
                    <label className="block">
                      <span className="text-sm font-medium">Last name</span>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="mt-1 block w-full border rounded p-2"
                      />
                    </label>
                  )}
                </div>
              )}

              <button
                onClick={() => completeRegistration({ birthYear: parseInt(birthYear, 10), displayNameType, firstName, lastName })}
                disabled={loading || !isOver18 || (displayNameType !== 'anonymous' && !firstName)}
                className="w-full py-2 rounded text-white font-medium disabled:opacity-50"
                style={{ backgroundColor: '#52B788' }}
              >
                {loading ? 'Creating account...' : 'Complete registration'}
              </button>
            </>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="text-center space-y-2">
          <p className="text-xl font-semibold" style={{ color: '#52B788' }}>
            Welcome to senseUS!
          </p>
          <p className="text-sm text-gray-600">Your account has been created.</p>
        </div>
      )}
    </div>
  )
}
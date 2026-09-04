import { Link } from 'react-router-dom'
import { usePageTitle } from '../hooks/usePageTitle'

export default function NotFound() {
  usePageTitle('Page Not Found')
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3rem 1.5rem',
        background: '#E9E9EC',
        boxSizing: 'border-box',
        fontFamily: 'Merriweather, serif',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '380px', width: '100%' }}>

        <div style={{ fontSize: '28px', fontWeight: 500, color: '#2D3DCA', marginBottom: '4px' }}>
          sense<span style={{ fontWeight: 700 }}>US</span>
        </div>
        <div style={{ fontSize: '11px', color: '#6B7280', letterSpacing: '0.05em', marginBottom: '3rem' }}>
          real humans. real opinions. real truth.
        </div>

        {/* A small bounce-in so this one orphaned fallback page shares a
            little of the motion language the rest of the app has, instead
            of a static numeral sitting there. */}
        <div style={{ fontSize: '72px', fontWeight: 700, color: '#2D3DCA', lineHeight: 1, marginBottom: '1rem', animation: 'senseus-bounce-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
          404
        </div>

        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
          This page doesn't exist
        </h1>

        <p style={{ fontSize: '14px', color: '#6B7280', lineHeight: 1.7, marginBottom: '2rem' }}>
          The page you're looking for may have moved, been removed, or never existed in the first place. Happens to the best of us.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Link
            to="/"
            style={{
              display: 'block',
              padding: '12px',
              background: '#2D3DCA',
              color: 'white',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              textAlign: 'center',
            }}
          >
            Go home
          </Link>
          <Link
            to="/vote"
            style={{
              display: 'block',
              padding: '12px',
              background: 'transparent',
              color: '#2D3DCA',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 700,
              textDecoration: 'none',
              textAlign: 'center',
              border: '1.5px solid #2D3DCA',
            }}
          >
            Go vote on something
          </Link>
        </div>

        <div style={{ marginTop: '3rem', display: 'flex', gap: '1.5rem', justifyContent: 'center' }}>
          <a href="/privacy" style={{ fontSize: '11px', color: '#6B7280', textDecoration: 'none' }}>Privacy</a>
          <a href="/terms" style={{ fontSize: '11px', color: '#6B7280', textDecoration: 'none' }}>Terms</a>
          <a href="/mission" style={{ fontSize: '11px', color: '#6B7280', textDecoration: 'none' }}>Mission</a>
        </div>

      </div>
    </div>
  )
}
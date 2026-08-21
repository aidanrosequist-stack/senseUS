import AnimatedWordmark from '../components/layout/AnimatedWordmark'
import { Link } from 'react-router-dom'

export default function Home() {
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
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '380px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: '2.5rem' }}>
          <img
            src="/senseUS-logo.png"
            alt="senseUS"
            style={{ height: '120px', width: 'auto', marginBottom: '8px' }}
          />
          <div style={{ fontSize: '36px', fontWeight: 500, color: '#1A1A1A', marginBottom: '4px' }}>
            sense<AnimatedWordmark />
          </div>
          <div style={{ fontSize: '12px', color: '#6B7280', letterSpacing: '0.05em', marginBottom: '8px' }}>
            real humans. real opinions. real truth.
          </div>
          <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '12px' }}>
            Operated by Gudboi Enterprises, LLC
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/how-it-works" style={{ fontSize: '12px', color: '#2D3DCA', textDecoration: 'none', fontWeight: 500 }}>How It Works</a>
            <a href="/transparency" style={{ fontSize: '12px', color: '#2D3DCA', textDecoration: 'none', fontWeight: 500 }}>Transparency</a>
            <a href="/mission" style={{ fontSize: '12px', color: '#2D3DCA', textDecoration: 'none', fontWeight: 500 }}>Our Mission</a>
            <a href="/privacy" style={{ fontSize: '12px', color: '#2D3DCA', textDecoration: 'none', fontWeight: 500 }}>Privacy Policy</a>
            <a href="/terms" style={{ fontSize: '12px', color: '#2D3DCA', textDecoration: 'none', fontWeight: 500 }}>Terms of Service</a>
            <a href="/register" style={{ fontSize: '12px', color: '#2D3DCA', textDecoration: 'none', fontWeight: 500 }}>Sign Up</a>
          </div>
        </div>

        {/* Pitch */}
        <div style={{
          width: '100%',
          background: '#FFFFFF',
          border: '0.5px solid #E5E7EB',
          borderRadius: '16px',
          padding: '1.25rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          marginBottom: '1.5rem',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: '18px', fontWeight: 500, color: '#1A1A1A', lineHeight: 1.5, margin: '0 0 10px' }}>
            What do people actually think?
          </p>
          <p style={{ fontSize: '14px', color: '#6B7280', lineHeight: 1.7, margin: '0 0 10px' }}>
            senseUS is a verified opinion platform operated by Gudboi Enterprises, LLC. One account per real human. No bots. No manipulation. Just honest Yes/No answers to the questions that matter, for the best humankind data we can provide.
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '4px' }}>
            <Link to="/how-it-works" style={{ fontSize: '13px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none', border: '1.5px solid #2D3DCA', borderRadius: '8px', padding: '7px 14px' }}>
              How it works
            </Link>
            <Link to="/mission" style={{ fontSize: '13px', color: '#2D3DCA', fontWeight: 500, textDecoration: 'none', border: '1.5px solid #2D3DCA', borderRadius: '8px', padding: '7px 14px' }}>
              Our mission
            </Link>
          </div>
        </div>

        <Link
          to="/register"
          style={{
            width: '100%',
            display: 'block',
            boxSizing: 'border-box',
            textAlign: 'center',
            padding: '13px',
            background: '#2D3DCA',
            color: 'white',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: 600,
            textDecoration: 'none',
            marginBottom: '1.5rem',
            fontFamily: "'Merriweather', serif",
          }}
        >
          Get started — verify with your phone
        </Link>

        <div
          style={{
            width: '100%',
            background: '#FFFFFF',
            border: '0.5px solid #E5E7EB',
            borderRadius: '16px',
            padding: '1.25rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            marginBottom: '1.5rem',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '13px', color: '#6B7280', lineHeight: 1.6, margin: '0 0 10px' }}>
            Believe in this mission? Get a nice picture or two <em>and</em> help me keep the light on, here:
          </p>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🥁</div>
          
            <a href="https://lightwillprevail.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '9px 20px',
              background: '#0D0D0D',
              color: '#ff9900',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500,
              textDecoration: 'none',
              fontFamily: "'Rock Salt', cursive",
            }}
          >
            Visit lightwillprevail.com
          </a>
        </div>

        <div style={{ width: '100%', marginTop: '1rem', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#9CA3AF', lineHeight: 1.6, margin: '0 0 0.75rem' }}>
            senseUS is a verified human opinion platform. Our mission is to create a trusted, bot-free source of truth for public opinion.
          </p>
          <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 0.75rem' }}>
            Contact us: <a href="mailto:hello@senseus.app" style={{ color: '#6B7280', textDecoration: 'none' }}>hello@senseus.app</a>
          </p>
          <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/privacy" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none' }}>Privacy Policy</a>
            <a href="/terms" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none' }}>Terms of Service</a>
            <a href="/mission" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none' }}>Our Mission</a>
            <a href="/ethos" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none' }}>Our Ethos</a>
            <a href="/how-it-works" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none' }}>How It Works</a>
            <a href="/login" style={{ fontSize: '11px', color: '#2D3DCA', textDecoration: 'none', fontWeight: 500 }}>Log in</a>
          </div>
        </div>

      </div>
    </div>
  )
}
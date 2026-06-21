import { Link } from 'react-router-dom'

export default function Mission() {
  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '3rem 1.5rem', fontFamily: 'Georgia, serif', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '2.5rem' }}>
        <Link to="/" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none', fontFamily: 'Arial, sans-serif' }}>
          ← back
        </Link>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '28px', fontWeight: 500, color: '#2D3DCA', fontFamily: 'Arial, sans-serif', marginBottom: '4px' }}>
          sense<span style={{ fontWeight: 700 }}>US</span>
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 500, color: '#1A1A1A', margin: '0', fontFamily: 'Arial, sans-serif' }}>
          Our Mission
        </h1>
      </div>

      <div style={{ fontSize: '16px', lineHeight: 1.8, color: '#1A1A1A' }}>

        <p>We live in an era of manufactured consensus, what seems like purposeful division and perhaps even contention that is driven intentionally. Bots flood social media. Algorithms amplify outrage. Poll numbers get spun before the ink is dry. Nobody knows what people actually think anymore. We believe most people think for themselves; outside of party lines, beyond religious affiliations and more nuanced than any box that someone tries to put you in.</p>

        <p>senseUS aims to fix that.</p>

        <p>We built a platform where every voice belongs to a verified human being. One person, one account, one vote. No bots. No fake accounts. No coordinated manipulation. Just real people answering real questions, honestly, and anonymously. Because we believe that your opinion matters. Not an algorithm's version of it. Not a bot's approximation of it. Yours. And we believe that you shouldn't be afraid to voice it; in fact, you should be <em>encouraged</em> to voice it.</p>

        <p>We believe that knowing what humanity actually thinks, without interference, is foundational to a functioning democracy. It's infrastructure for truth.</p>

        <p>And besides, we're <em>really, really</em> curious what your answers are going to be to some of these.</p>

        <p style={{ marginTop: '2.5rem' }}>Let the light prevail.</p>

        <p style={{ marginTop: '1.5rem', fontSize: '15px', color: '#6B7280', fontFamily: 'Arial, sans-serif' }}>
          Sincerely,<br />
          <span style={{ color: '#1A1A1A', fontStyle: 'normal' }}>Aidan and Claude</span>
        </p>

      </div>

      <div style={{ borderTop: '0.5px solid #E5E7EB', marginTop: '3rem', paddingTop: '1.5rem', display: 'flex', gap: '1.5rem' }}>
        <a href="/privacy" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none', fontFamily: 'Arial, sans-serif' }}>Privacy Policy</a>
        <a href="/terms" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none', fontFamily: 'Arial, sans-serif' }}>Terms of Service</a>
      </div>

    </div>
  )
}
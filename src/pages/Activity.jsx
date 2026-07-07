import { Link } from 'react-router-dom'
import BottomNav from '../components/layout/BottomNav'

export default function Activity() {
  return (
    <div style={{ maxWidth: '420px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', minHeight: '100dvh', paddingBottom: '80px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div style={{ fontSize: '20px', fontWeight: 400, color: '#1A1A1A' }}>
          sense<span style={{ fontWeight: 700, color: '#2D3DCA' }}>US</span>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
        <div style={{ fontSize: '32px', marginBottom: '1rem' }}>🔔</div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.5rem' }}>
          Activity is coming soon
        </h2>
        <p style={{ fontSize: '14px', color: '#6B7280', lineHeight: 1.7, margin: '0 auto', maxWidth: '280px' }}>
          Once conversations are live, you'll see replies to your comments, shifts in questions you've voted on, and badge achievements here.
        </p>
      </div>

      <BottomNav />
    </div>
  )
}
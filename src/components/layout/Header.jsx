export default function Header() {
  return (
    <div style={{
      width: '100%',
      background: '#FFFFFF',
      borderBottom: '0.5px solid #E5E7EB',
      display: 'flex',
      justifyContent: 'center',
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
        padding: '1px 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        boxSizing: 'border-box',
      }}>
        <img
          src="/senseUS-logo.png"
          alt="senseUS"
          style={{ height: '90px', width: 'auto' }}
        />
        <div style={{ fontFamily: 'Merriweather, serif' }}>
          <div style={{ fontSize: '24px', fontWeight: 400, color: '#1A1A1A', lineHeight: 1 }}>
            sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
          </div>
          <div style={{ fontSize: '12px', color: '#6B7280', letterSpacing: '0.03em', marginTop: '2px' }}>
            THE societal media platform
          </div>
        </div>
      </div>
    </div>
  )
}
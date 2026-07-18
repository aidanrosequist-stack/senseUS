export default function Header() {
  return (
    <div style={{
      width: '100%',
      maxWidth: '480px',
      margin: '0 auto',
      padding: '12px 1.5rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <img
          src="/senseUS logo.png"
          alt="senseUS"
          style={{ height: '32px', width: 'auto' }}
        />
        <div style={{ fontFamily: 'Merriweather, serif' }}>
          <div style={{ fontSize: '16px', fontWeight: 400, color: '#1A1A1A', lineHeight: 1 }}>
            sense<span style={{ fontWeight: 700, color: '#2D3DCA' }}>US</span>
          </div>
          <div style={{ fontSize: '9px', color: '#6B7280', letterSpacing: '0.03em', marginTop: '2px' }}>
            THE societal media platform
          </div>
        </div>
      </div>
    </div>
  )
}
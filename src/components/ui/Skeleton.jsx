export function Skeleton({ width = '100%', height = '16px', borderRadius = '6px', style = {} }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: 'linear-gradient(90deg, #E5E7EB 25%, #F3F4F6 50%, #E5E7EB 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.5s infinite',
        ...style,
      }}
    />
  )
}

export function SkeletonCard({ style = {} }) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', ...style }}>
      <Skeleton height="13px" width="70%" style={{ marginBottom: '8px' }} />
      <Skeleton height="11px" width="40%" />
    </div>
  )
}

export function SkeletonStatGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px', marginBottom: '1.5rem' }}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} style={{ background: '#F9FAFB', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
          <Skeleton height="11px" width="60%" style={{ margin: '0 auto 8px' }} />
          <Skeleton height="24px" width="40%" style={{ margin: '0 auto 6px' }} />
          <Skeleton height="11px" width="30%" style={{ margin: '0 auto' }} />
        </div>
      ))}
    </div>
  )
}
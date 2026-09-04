// Shared loading indicator — replaces the bare "Loading..." text that used
// to be independently duplicated across ~14 files (every page's own loading
// branch, plus App.jsx's route-level Suspense fallback and ProtectedRoute's
// auth check). A shimmering Skeleton (see Skeleton.jsx) is the right choice
// when the eventual content's shape is already known — Explore/Activity/
// Profile already do that. This is for the opposite case: a full-page or
// small inline wait where there's no specific shape to preview, just a
// generic "something is loading" moment — a spinning ring reads as more
// intentional than a static word, without pretending to preview content
// that isn't there.
export default function LoadingSpinner({ label = 'Loading...', size = 28 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
      <div
        aria-hidden="true"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          border: '3px solid #E5E7EB',
          borderTopColor: '#2D3DCA',
          animation: 'senseus-spin 0.7s linear infinite',
          flexShrink: 0,
        }}
      />
      {label && (
        <div style={{ fontSize: '13px', color: '#6B7280', fontFamily: 'Merriweather, serif' }}>
          {label}
        </div>
      )}
    </div>
  )
}

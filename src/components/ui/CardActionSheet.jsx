// A shared bottom-sheet menu, opened by long-pressing a card anywhere in
// the app. Each surface passes in its own list of relevant actions —
// Explore/Shifts might offer Share + View, Comments offers two separate
// share options, History/Revisit add Change vote — rather than this
// component assuming a fixed set of buttons every time.
//
// actions: [{ label: string, onClick: () => void, danger?: boolean }]
export default function CardActionSheet({ title, actions, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          background: '#FFFFFF',
          borderRadius: '16px 16px 0 0',
          padding: '1.5rem',
          paddingBottom: '2rem',
          fontFamily: 'Merriweather, serif',
          boxSizing: 'border-box',
        }}
      >
        {title && (
          <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '1rem', lineHeight: 1.4 }}>
            {title}
          </div>
        )}
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={() => { action.onClick(); onClose() }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '14px 0',
              background: 'none',
              border: 'none',
              borderTop: '0.5px solid #E5E7EB',
              fontSize: '14px',
              color: action.danger ? '#7a1313' : '#1A1A1A',
              cursor: 'pointer',
              fontFamily: 'Merriweather, serif',
            }}
          >
            {action.label}
          </button>
        ))}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            textAlign: 'center',
            padding: '14px 0',
            marginTop: '8px',
            background: '#F3F4F6',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            color: '#6B7280',
            cursor: 'pointer',
            fontFamily: 'Merriweather, serif',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

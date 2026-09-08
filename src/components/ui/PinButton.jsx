import { IconPin, IconPinFilled } from '@tabler/icons-react'

// Shared pin/unpin toggle — a single icon that changes color/fill on
// click, same interaction shape as the resonate button (Conversation.jsx)
// but deliberately its own separate control, since pinning is a private,
// personal "let me find this again" bookmark (feeds the Pinned tab in
// /activity) rather than a public signal like resonating (which is
// visible to everyone and feeds resonance_count/scoring). Used on
// question thumbnails (Explore) and individual comments (Conversation).
//
// e.stopPropagation() matters here — every surface this sits on is
// itself clickable (navigate) or long-press-triggering (Explore's
// thumbnails), so without it a tap on the pin icon would also fire
// whatever the card underneath it does.
export default function PinButton({ pinned, onToggle, size = 16, style }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-label={pinned ? 'Unpin' : 'Pin'}
      aria-pressed={pinned}
      title={pinned ? 'Unpin' : 'Pin'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'none',
        border: 'none',
        padding: '2px',
        cursor: 'pointer',
        color: pinned ? '#2D3DCA' : '#9CA3AF',
        ...style,
      }}
    >
      {pinned ? <IconPinFilled size={size} /> : <IconPin size={size} />}
    </button>
  )
}

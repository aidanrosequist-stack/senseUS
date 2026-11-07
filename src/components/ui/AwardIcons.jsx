import { useId } from 'react'
import { AWARD_CATALOG, AWARD_BY_ID } from '../../lib/awardInfo'

// Comment Awards — icon rendering (AwardIcon, AwardPills). The catalog
// itself (id/label/cost/colors) lives in src/lib/awardInfo.js, not here —
// see that file's header for why the data and the components had to be
// split apart.
//
// Visual design approved by Aidan over several rounds on a standalone
// mockup: flat-colored circular badges for the 8 "everyday" (cost 1)
// awards, each its own hue; the two "big" (cost 5) awards get a glossy
// 3-D medal treatment (radial-gradient sphere + layered box-shadow +
// SVG linear-gradient fill + drop-shadow) instead of a flat icon, to
// read as visibly more significant.

// The inner glyph only (path/shape), for the 8 flat "everyday" icons —
// AwardIcon below wraps this in the colored circle badge.
function EverydayGlyph({ id, fg }) {
  switch (id) {
    case 'well-argued':
      return (
        <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5 H20 V15 H13 L9 19 V15 H4 Z" />
          <path d="M9.2 10.6 L11 12.4 L15 8" />
        </svg>
      )
    case 'changed-my-mind':
      return (
        <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12 a8 8 0 0 1 13.9 -5.4" />
          <path d="M18.6 3.4 L17.9 6.6 L14.7 6.2" />
          <path d="M20 12 a8 8 0 0 1 -13.9 5.4" />
          <path d="M5.4 20.6 L6.1 17.4 L9.3 17.8" />
        </svg>
      )
    case 'brought-receipts':
      return (
        <svg width="50%" height="55%" viewBox="0 0 22 26" fill="none" stroke={fg} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 2 H18 V22 L15.5 20 L13 22 L10.5 20 L8 22 L5.5 20 L4 22 Z" />
          <line x1="7" y1="7.5" x2="15" y2="7.5" />
          <line x1="7" y1="11.5" x2="15" y2="11.5" />
          <line x1="7" y1="15.5" x2="12" y2="15.5" />
        </svg>
      )
    case 'made-me-laugh':
      return (
        <svg width="58%" height="58%" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9.2" />
          <path d="M8.2 9.6 Q8.9 8.3 9.7 9.6" />
          <path d="M14.3 9.6 Q15 8.3 15.8 9.6" />
          <path d="M7.6 13.2 Q12 18.5 16.4 13.2" />
        </svg>
      )
    case 'fair-and-balanced':
      return (
        <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="3" x2="12" y2="19" />
          <line x1="5" y1="7" x2="19" y2="7" />
          <path d="M5 7 L2.5 12.5 a3 3 0 0 0 5 0 Z" />
          <path d="M19 7 L16.5 12.5 a3 3 0 0 0 5 0 Z" />
          <line x1="8.5" y1="21" x2="15.5" y2="21" />
        </svg>
      )
    case 'good-faith-disagreement':
      return (
        <svg width="62%" height="50%" viewBox="0 0 28 22" fill="none" stroke={fg} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 11 H11" />
          <path d="M7 6.5 L12 11 L7 15.5" />
          <path d="M26 11 H17" />
          <path d="M21 6.5 L16 11 L21 15.5" />
        </svg>
      )
    case 'needs-a-source':
      return (
        <svg width="48%" height="56%" viewBox="0 0 22 25" fill="none" stroke={fg} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 2 H14 L18 6 V23 H4 Z" />
          <path d="M14 2 V6 H18" />
          <path d="M9 13.4 a2 2 0 1 1 2.6 1.9 c-.8 .5 -1.1 1 -1.1 1.9" strokeWidth="1.6" />
          <circle cx="10.5" cy="20.2" r="0.15" strokeWidth="2.4" />
        </svg>
      )
    case 'off-topic':
      return (
        <svg width="55%" height="55%" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2.6" strokeLinecap="round">
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </svg>
      )
    default:
      return null
  }
}

// AwardIcon: the full badge — colored circle + glyph for the 8 everyday
// awards, or the glossy 3-D medal treatment for Gold Star / Needs Work.
// `size` is the circle's diameter in px; everything inside scales off it.
//
// Gold Star / Needs Work each render an inline <linearGradient> — since a
// comment thread can show many Gold Star icons at once (pills on several
// comments, the picker grid, a detail list), each instance gets its own
// unique gradient id via useId() rather than a fixed string, so multiple
// instances on the same page never collide in the DOM.
export default function AwardIcon({ id, size = 44 }) {
  const award = AWARD_BY_ID[id]
  const gradId = useId()
  if (!award) return null

  if (id === 'gold-star') {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: '50%', flexShrink: 0,
          background: 'radial-gradient(circle at 34% 28%, #FFF3C4 0%, #F0C33E 52%, #A9790A 100%)',
          boxShadow: '0 12px 20px rgba(169,121,10,0.4), inset 0 -8px 14px rgba(110,74,6,0.45), inset 0 5px 8px rgba(255,255,255,0.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        aria-hidden="true"
      >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 2px rgba(80,54,4,0.45))' }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFF6D9" />
              <stop offset="55%" stopColor="#F4CE4D" />
              <stop offset="100%" stopColor="#B9850C" />
            </linearGradient>
          </defs>
          <path
            d="M12 2.2 L14.9 8.6 L21.8 9.4 L16.6 14.2 L18.1 21 L12 17.4 L5.9 21 L7.4 14.2 L2.2 9.4 L9.1 8.6 Z"
            fill={`url(#${gradId})`} stroke="#7A5A08" strokeWidth="1" strokeLinejoin="round"
          />
        </svg>
      </div>
    )
  }

  if (id === 'needs-work') {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: '50%', flexShrink: 0,
          background: 'radial-gradient(circle at 34% 28%, #FAFAFA 0%, #9CA3AF 52%, #374151 100%)',
          boxShadow: '0 12px 20px rgba(55,65,81,0.4), inset 0 -8px 14px rgba(17,24,39,0.45), inset 0 5px 8px rgba(255,255,255,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        aria-hidden="true"
      >
        <svg width={size * 0.63} height={size * 0.63} viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 3px 3px rgba(40,40,40,0.5))' }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F3A6A6" />
              <stop offset="55%" stopColor="#D65C5C" />
              <stop offset="100%" stopColor="#7A1E1E" />
            </linearGradient>
          </defs>
          <path
            d="M9 2 H15 V12 L19 12 L12 21 L5 12 L9 12 Z"
            fill={`url(#${gradId})`} stroke="#5C1414" strokeWidth="1" strokeLinejoin="round"
          />
        </svg>
      </div>
    )
  }

  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0, background: award.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      aria-hidden="true"
    >
      <EverydayGlyph id={id} fg={award.fg} />
    </div>
  )
}

// AwardPills: the small "N awards" summary shown under a comment that's
// received at least one, built off get_conversation_comments()'s
// award_counts column (a jsonb map of award_type -> distinct-giver
// count, or null if the comment has never been awarded). Clicking it is
// the entry point to the "who gave this" expand (Conversation.jsx owns
// that fetch/state; this component just renders the summary and reports
// the click via onClick).
export function AwardPills({ counts, onClick }) {
  if (!counts) return null
  const entries = AWARD_CATALOG
    .filter((a) => counts[a.id] > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  if (entries.length === 0) return null

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
        background: 'none', border: 'none', cursor: onClick ? 'pointer' : 'default', padding: 0, margin: '6px 0 0',
      }}
      title="See who gave these awards"
    >
      {entries.map((award) => (
        <span key={award.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', background: '#F3F4F6', borderRadius: '20px', padding: '2px 8px 2px 2px' }}>
          <AwardIcon id={award.id} size={16} />
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#4B5563', fontFamily: 'Merriweather, serif' }}>
            {counts[award.id]}
          </span>
        </span>
      ))}
    </button>
  )
}

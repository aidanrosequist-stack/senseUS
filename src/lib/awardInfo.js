// Comment Awards — the 10-award catalog (id, label, cost, polarity,
// colors). Single source of truth, mirroring badgeInfo.js's own role for
// badges. Lives here (plain data/functions only, no JSX) rather than
// alongside AwardIcon/AwardPills in src/components/ui/AwardIcons.jsx —
// that file mixes components with this data tripped the same
// react-refresh/only-export-components ESLint rule that made sound.js
// get split out of VoteCard.jsx (see sound.js's own header comment for
// that precedent): a file Fast Refresh treats as a component module has
// to export only components.
//
// sort_order here matches award_types.sort_order in migration
// 105_comment_awards.sql exactly — keep them in sync if either changes.

export const AWARD_CATALOG = [
  {
    id: 'gold-star',
    label: 'Gold Star',
    description: 'This comment was great, full stop.',
    cost: 5,
    isNegative: false,
    sortOrder: 1,
  },
  {
    id: 'needs-work',
    label: 'Needs Work',
    description: 'The antithesis of the Gold Star.',
    cost: 5,
    isNegative: true,
    sortOrder: 2,
  },
  {
    id: 'well-argued',
    label: 'Well-Argued',
    description: 'A clear, well-supported point.',
    cost: 1,
    isNegative: false,
    bg: '#E3E4FC',
    fg: '#5457D1',
    sortOrder: 3,
  },
  {
    id: 'changed-my-mind',
    label: 'Changed My Mind',
    description: 'This actually shifted your view.',
    cost: 1,
    isNegative: false,
    bg: '#D7F3EF',
    fg: '#0D9488',
    sortOrder: 4,
  },
  {
    id: 'brought-receipts',
    label: 'Brought Receipts',
    description: 'Backed up with real sources.',
    cost: 1,
    isNegative: false,
    bg: '#FCEACB',
    fg: '#C2740A',
    sortOrder: 5,
  },
  {
    id: 'made-me-laugh',
    label: 'Made Me Laugh',
    description: 'Genuinely funny.',
    cost: 1,
    isNegative: false,
    bg: '#FBDCEA',
    fg: '#C2227E',
    sortOrder: 6,
  },
  {
    id: 'fair-and-balanced',
    label: 'Fair & Balanced',
    description: 'Weighed both sides fairly.',
    cost: 1,
    isNegative: false,
    bg: '#DCE8FD',
    fg: '#2563EB',
    sortOrder: 7,
  },
  {
    id: 'good-faith-disagreement',
    label: 'Good-Faith Disagreement',
    description: "Disagreed, but argued it straight.",
    cost: 1,
    isNegative: false,
    bg: '#DBF3E3',
    fg: '#16A34A',
    sortOrder: 8,
  },
  {
    id: 'needs-a-source',
    label: 'Needs a Source',
    description: 'A claim here could use a citation.',
    cost: 1,
    isNegative: true,
    bg: '#F0DCC8',
    fg: '#92400E',
    sortOrder: 9,
  },
  {
    id: 'off-topic',
    label: 'Off-Topic',
    description: "Doesn't really engage with the question.",
    cost: 1,
    isNegative: true,
    bg: '#EBE0FB',
    fg: '#7C3AED',
    sortOrder: 10,
  },
]

export const AWARD_BY_ID = Object.fromEntries(AWARD_CATALOG.map((a) => [a.id, a]))

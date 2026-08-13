// Single source of truth for badge labels, descriptions, and emojis —
// shared between Profile.jsx (full badge widget) and Compare.jsx
// (emoji-only display of a friend's badges). Add new badges here once,
// and they're automatically available everywhere that imports this.

export const BADGE_INFO = {
  'ultra-definitive': { label: 'Ultra-Definitive', description: '100+ votes, less than 10% leaning', emoji: '🎯' },
  'decisive-streak': { label: 'Decisive Streak', description: '20 consecutive definitive votes', emoji: '🔥' },
  'super-decisive-streak': { label: 'Super Decisive Streak', description: '50 consecutive definitive votes', emoji: '⚡' },
  'civically-engaged': { label: 'Civically Engaged', description: '100 total votes cast', emoji: '🗳️' },
  'voice-of-the-people': { label: 'Voice of the People', description: '500 total votes cast', emoji: '🌍' },
  'conversationalist': { label: 'Conversationalist', description: '50 comments or replies shared', emoji: '💬' },
  'town-crier': { label: 'Town Crier', description: '100 comments or replies shared', emoji: '📢' },
  'conversation-starter': { label: 'Conversation Starter', description: '10 direct replies on one comment', emoji: '🗣️' },
  'lightning-rod': { label: 'Lightning Rod', description: '50 direct replies on one comment', emoji: '⚡' },
  'on-a-roll': { label: 'On a Roll', description: '7-day voting streak', emoji: '🔥' },
  'unstoppable': { label: 'Unstoppable', description: '30-day voting streak', emoji: '🌋' },
  'constant-as-the-sun': { label: 'Constant as the Sun', description: '100-day voting streak', emoji: '☀️' },
  'ripple-maker': { label: 'Ripple Maker', description: 'Resonated with 20 comments', emoji: '🌊' },
  'amplifier': { label: 'Amplifier', description: 'Resonated with 50 comments', emoji: '🔊' },
  'watchful-eye': { label: 'Watchful Eye', description: 'Flagged 10 comments', emoji: '🛡️' },
  'guardian-of-truth': { label: 'Guardian of Truth', description: 'Flagged 50 comments', emoji: '⚖️' },
  'founding-member': { label: 'Founding Member', description: 'One of the first 500 to join', emoji: '🏛️' },
  'well-rounded': { label: 'Well-Rounded', description: 'Voted in every domain', emoji: '🧭' },
  'open-minded': { label: 'Open Minded', description: 'Changed your vote on 10 questions', emoji: '🔄' },
  'first-responder': { label: 'First Responder', description: 'Among the first 10 voters, 10 times', emoji: '⏱️' },
  'diligent-researcher': { label: 'Diligent Researcher', description: 'Read the articles behind 10 questions', emoji: '📚' },
  'diligent-researcher-2': { label: 'Master Researcher', description: 'Read the articles behind 50 questions', emoji: '📖' },
}

export const BADGE_EMOJI = Object.fromEntries(
  Object.entries(BADGE_INFO).map(([key, val]) => [key, val.emoji])
)

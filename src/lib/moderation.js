// Banned words list — extend as needed
const BANNED_WORDS = [
  // Slurs and hate speech — intentionally not spelled out in full here
  'nigger', 'nigga', 'faggot', 'fag', 'kike', 'spic', 'chink', 'gook',
  'wetback', 'towelhead', 'raghead', 'tranny', 'retard', 'retarded',
  // Severe profanity
  'cunt', 'motherfucker', 'motherfucking',
  // Sexual exploitation of minors — must stay in sync with moderate_comment()'s
  // banned_words array (supabase/migrations/000_functions.sql). The DB is the
  // authoritative check either way, but without these here a blocked comment
  // hits a raw Postgres error instead of this file's friendly message.
  'pedophile', 'pedo', 'pedofile',
]

// Words that get flagged for human review but not blocked outright
const REVIEW_WORDS = [
  'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'bastard', 'dick',
  'pussy', 'cock', 'whore', 'slut', 'damn', 'ass', 'crap', 'piss',
  'hell', 'idiot', 'moron', 'stupid', 'dumb', 'loser', 'freak',
]

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

function containsWord(text, wordList) {
  const normalized = normalize(text)
  const words = normalized.split(' ')
  return wordList.some(banned => {
    const normalizedBanned = normalize(banned)
    return words.includes(normalizedBanned) ||
      normalized.includes(normalizedBanned)
  })
}

// Whole-word only — no substring fallback. containsWord()'s substring
// check (used for comments, above) is deliberately loose to catch things
// like a banned word glued onto other text, but that same looseness turns
// into real false positives on ordinary names: "Hassan", "Cassandra", and
// "assassin" all contain "ass" as a substring and would otherwise get
// rejected outright. That's an acceptable miss for one comment among many
// (a human can still see and act on it) but not for something that blocks
// a legitimate person from setting their own name.
function containsWholeWord(text, wordList) {
  const words = normalize(text).split(' ')
  return wordList.some(banned => words.includes(normalize(banned)))
}

// For profile fields (first name, bio) rather than comments — reused by
// Register.jsx (first name at signup) and Settings.jsx (first name and
// bio, editable any time afterward). Unlike checkComment(), which lets
// REVIEW_WORDS through with a flag for a human moderator to look at later,
// this blocks both tiers outright: a display name or bio is a persistent,
// always-visible label with no equivalent moderation queue, so there's no
// "let it through and flag for review" middle ground the way there is for
// a single comment. Empty text is allowed here (a first name is optional
// for an Anonymous account, and bio always has been) — required-ness is
// each caller's own concern, not this function's.
export function checkDisplayText(text, label = 'This') {
  if (!text || !text.trim()) {
    return { allowed: true, reason: null }
  }

  if (containsWholeWord(text, BANNED_WORDS) || containsWholeWord(text, REVIEW_WORDS)) {
    return {
      allowed: false,
      reason: `${label} contains language that isn't allowed on senseUS. Please choose something else.`,
    }
  }

  return { allowed: true, reason: null }
}

export function checkComment(text) {
  if (!text || !text.trim()) {
    return { allowed: false, reason: 'Comment cannot be empty.' }
  }

  if (text.trim().length < 2) {
    return { allowed: false, reason: 'Comment is too short.' }
  }

  if (text.length > 1000) {
    return { allowed: false, reason: 'Comment must be under 1000 characters.' }
  }

  if (containsWord(text, BANNED_WORDS)) {
    return {
      allowed: false,
      reason: 'Your comment contains language that isn\'t allowed on senseUS. Please revise and try again.'
    }
  }

  if (containsWord(text, REVIEW_WORDS)) {
    return {
      allowed: true,
      flagged: true,
      reason: null
    }
  }

  return { allowed: true, flagged: false, reason: null }
}
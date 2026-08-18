// Banned words list — extend as needed
const BANNED_WORDS = [
  // Slurs and hate speech — intentionally not spelled out in full here
  'nigger', 'nigga', 'faggot', 'fag', 'kike', 'spic', 'chink', 'gook',
  'wetback', 'towelhead', 'raghead', 'tranny', 'retard', 'retarded',
  // Severe profanity
  'cunt', 'motherfucker', 'motherfucking',
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
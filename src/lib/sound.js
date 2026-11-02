// Shared tiny Web Audio tone generator — moved out of VoteCard.jsx
// (2026-11-02) so Party.jsx's results-reveal cue can reuse the exact same
// generator instead of duplicating it, and so it lives in a file that
// only exports plain functions/constants rather than a React component
// (VoteCard.jsx exporting playSound alongside its default component
// export tripped react-refresh/only-export-components — Fast Refresh
// only works when a file exports components and nothing else).
//
// Single source of truth for every short tone this app plays: VoteCard's
// own stance sounds (yes/ly/ln/no) and Party.jsx's "celebrate" cue on a
// completed ?Party!'s results reveal.

// Reused across the whole session instead of creating (and leaking) a
// new AudioContext on every sound effect. Exported too -- VoteCard's own
// hold-to-vote completion chime builds its own one-off oscillator
// straight off this same shared context, rather than going through
// playSound()'s fixed configs.
let sharedAudioCtx = null
export function getAudioContext() {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume()
  }
  return sharedAudioCtx
}

export function playSound(type) {
  if (localStorage.getItem('senseus_sound') === 'off') return
  const ctx = getAudioContext()
  const oscillator = ctx.createOscillator()
  const gainNode = ctx.createGain()
  oscillator.connect(gainNode)
  gainNode.connect(ctx.destination)

  const configs = {
    yes:        { frequency: 520, duration: 0.08, gain: 0.15 },
    ly:         { frequency: 440, duration: 0.07, gain: 0.12 },
    ln:         { frequency: 320, duration: 0.07, gain: 0.12 },
    no:         { frequency: 240, duration: 0.08, gain: 0.15 },
    // A brighter, longer ring than any vote-stance tone -- reserved for
    // the ?Party! results reveal (Party.jsx), so it reads as a small
    // celebration rather than just another vote confirmation.
    celebrate:  { frequency: 660, duration: 0.18, gain: 0.16 },
  }

  const config = configs[type] || configs.yes
  oscillator.frequency.setValueAtTime(config.frequency, ctx.currentTime)
  oscillator.type = 'sine'
  gainNode.gain.setValueAtTime(config.gain, ctx.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + config.duration)
  oscillator.start(ctx.currentTime)
  oscillator.stop(ctx.currentTime + config.duration)
}

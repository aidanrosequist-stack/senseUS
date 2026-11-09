import { useAuth } from '../../hooks/useAuth'

// Surfaces a plain "invite a friend" entry point behind an explicit,
// dedicated card, rather than leaving inviting someone only reachable by
// noticing it's possible via a generic question-share link.
//
// Shares are not tracked (migration 110): the link carries no ref tag,
// and nothing is recorded when you tap the button.
//
// Links straight to /register rather than through a specific /q/:number
// preview -- this is "come join the app," not "come see this question."
export default function InviteFriendCard() {
  const { user } = useAuth()

  async function invite() {
    if (!user?.id) return
    const url = `https://senseus.app/register`
    const shareData = { title: 'senseUS', text: 'Join me on senseUS — real humans, real opinions, real truth.', url }

    if (navigator.share) {
      // See VoteCard.jsx's shareQuestion() comment: navigator.share()
      // must be the first thing this handler does.
      try {
        await navigator.share(shareData)
      } catch (err) {
        if (err?.name !== 'AbortError') {
          console.error('navigator.share failed:', err)
          alert(`Couldn't open the share sheet (${err?.message || err?.name || 'unknown error'}). Here's the link:\n\n${url}`)
        }
      }
      return
    }

    try {
      await navigator.clipboard.writeText(url)
      alert('Invite link copied to clipboard!')
    } catch (err) {
      console.error('Clipboard write failed:', err)
      alert(`Couldn't copy automatically. Here's the link:\n\n${url}`)
      prompt('Copy this link:', url)
    }
  }

  return (
    <div style={{ marginBottom: '1.5rem', background: '#F3F4F6', borderRadius: '12px', padding: '14px 16px' }}>
      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', marginBottom: '4px' }}>
        Invite a friend
      </div>
      <p style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.5, marginTop: 0, marginBottom: '10px' }}>
        Know someone who'd have something to say? Send them a link to join.
      </p>
      <button
        onClick={invite}
        style={{ width: '100%', padding: '9px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
      >
        Share your invite link
      </button>
    </div>
  )
}

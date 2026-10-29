import { useAuth } from '../../hooks/useAuth'

// Surfaces each user's own tagged referral link behind an explicit,
// dedicated "invite a friend" entry point, rather than leaving it only
// reachable by noticing it's attached to a generic question-share link.
// The ?ref= mechanism itself already exists -- every "Share" button
// across the app tags its link this way (Explore.jsx, VoteCard.jsx,
// ResultsCard.jsx, Activity.jsx, Conversation.jsx), and a signup through
// it that goes on to vote counts toward the sharer's integrity weight
// (see migration 094_integrity_weight_sharing_and_comparing.sql). This
// component doesn't add any new backend plumbing -- it just gives that
// same link a clearer front door, per Aidan's request (2026-10-27) to
// put one in both Profile.jsx (above Notifications) and Activity.jsx's
// History tab (above "Compare your vote history with a friend").
//
// Links straight to /register rather than through a specific /q/:number
// preview -- this is "come join the app," not "come see this question."
// Register.jsx never rewrites the URL mid-flow (confirmed by reading it
// -- no navigate()/history calls until the final redirect, which happens
// after useRegistration.js's completeRegistration() has already read
// ?ref= from window.location.search), so the tag survives the whole
// phone-verify -> code -> details flow intact.
//
// Simplified (Aidan, 2026-10-29) from an explanatory card down to a
// plain button -- "just a regular blue button that matches the
// comparison button" (Activity.jsx's "Compare your vote history with a
// friend", same style here: width 100%, padding 8px, #2D3DCA, 700
// weight). The old card's own explanatory line ("if they join and vote,
// it counts...") doesn't need its own real estate anymore.
export default function InviteFriendCard() {
  const { user } = useAuth()

  async function invite() {
    if (!user?.id) return
    const url = `https://senseus.app/register?ref=${user.id}`
    const shareData = { title: 'senseUS', text: 'Join me on senseUS — real humans, real opinions, real truth.', url }

    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // User cancelled the share sheet — not an error, do nothing
      }
      return
    }

    try {
      await navigator.clipboard.writeText(url)
      alert('Invite link copied to clipboard!')
    } catch {
      prompt('Copy this link:', url)
    }
  }

  return (
    <button
      onClick={invite}
      style={{ width: '100%', marginBottom: '1.5rem', padding: '8px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
    >
      Invite a friend
    </button>
  )
}

import { Link } from 'react-router-dom'
import { useState } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#2D3DCA', marginBottom: '0.75rem', paddingBottom: '6px', borderBottom: '1px solid #E5E7EB' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function Detail({ title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: '0.5px solid #E5E7EB', borderRadius: '10px', marginBottom: '10px', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: '15px', fontWeight: 600, color: '#1A1A1A' }}>{title}</span>
        <span style={{ fontSize: '18px', color: '#6B7280', transform: open ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', fontSize: '14px', lineHeight: 1.8, color: '#374151' }}>
          {children}
        </div>
      )}
    </div>
  )
}

export default function HowItWorks() {
  usePageTitle('How It Works')
  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '3rem 1.5rem', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '2rem' }}>
        <Link to="/" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none' }}>
          ← back
        </Link>
      </div>

      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ fontSize: '28px', fontWeight: 500, color: '#1A1A1A', marginBottom: '4px' }}>
          sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 500, color: '#1A1A1A', margin: 0 }}>
          How It Works
        </h1>
      </div>

      {/* Friendly overview */}
      <Section title="The basics">
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151', marginBottom: '1rem' }}>
          senseUS is a verified opinion platform. Every person on senseUS is a real, verified human being — no bots, no fake accounts, no duplicate votes. We ask questions, you answer honestly, and together we build a trustworthy picture of what people actually think.
        </p>
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151' }}>
          It's free to use. There are no ads. Your individual opinions are never sold. What gets shared with the world is aggregate truth — the honest sum of millions of real human answers.
        </p>
      </Section>

      <Section title="Getting verified">
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151', marginBottom: '1rem' }}>
          To join senseUS, you verify a real phone number. We send a one-time code via SMS — you enter it, and you're in. One phone number, one account, one voice.
        </p>
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151' }}>
          Your phone number is never stored in our own application database — it's held only by our authentication provider, Supabase, solely so you can log back in. We don't ask for your email, your full name, or your date of birth (only your birth year, to confirm you're 18 or older). The less we know about you, the better — by design.
        </p>
      </Section>

      <Section title="Voting">
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151', marginBottom: '1rem' }}>
          Questions appear as cards. Swipe right for yes, left for no — or use the buttons if you prefer. There are four options: Yes, Leaning Yes, Leaning No, and No. No fence-sitting required, but nuance is welcome.
        </p>
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151', marginBottom: '1rem' }}>
          You can change your vote on any question at any time. We log the change anonymously — not to track you, but to detect manipulation patterns if they exist.
        </p>
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151' }}>
          Not sure how you feel? Tap <strong>Make Up My Mind</strong> to read a curated set of articles spanning pro, neutral, and con perspectives on the topic. Then come back and vote when you're ready.
        </p>
      </Section>

      <Section title="After you vote">
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151', marginBottom: '1rem' }}>
          Once you vote, you see how everyone else answered — a color bar showing the full breakdown across all four options, plus the simplified yes/no percentage. You also unlock the conversation: you can read and reply to what other verified humans are saying about the question.
        </p>
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151' }}>
          Before you vote, you can view the conversation — but not participate. Participating is something you earn by committing to an answer first.
        </p>
      </Section>

      <Section title="Your display name">
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151' }}>
          When you sign up, you choose how your name appears: First name + last initial, first name only, or a randomly assigned anonymous name from our curated list of 20 gender-neutral names. You can change this preference at any time from your profile.
        </p>
      </Section>

      {/* Deeper detail */}
      <div style={{ marginTop: '3rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1A1A1A', marginBottom: '4px' }}>
          Deeper detail
        </h2>
        <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '1.5rem' }}>
          For those who want to understand exactly how senseUS works under the hood.
        </p>
      </div>

      <Detail title="The integrity weighting system — what 'one voice' really means">
        <p>senseUS uses the phrase <em>one person, one account, one voice</em> — not "one vote." That distinction is deliberate and worth explaining.</p>
        <p style={{ marginTop: '0.75rem' }}>Every verified account starts with an integrity weight of 1.0000. Through consistent, verified participation over time, that weight can increase slightly — up to a maximum of 1.0050. Weights only go up; they never go down as a penalty.</p>
        <p style={{ marginTop: '0.75rem' }}>This means that in practice, a long-standing verified user's vote carries very slightly more weight than a brand new account — by at most 0.5%. It's a small upward nudge for trust, not a meaningful inequality. No individual's voice is suppressed or silenced.</p>
        <p style={{ marginTop: '0.75rem' }}>The weighting system exists to reward genuine participation and to give our data slightly more resistance to coordinated new-account manipulation. It is transparent, documented here, and subject to third-party audit.</p>
      </Detail>

      <Detail title="How questions are selected and curated">
        <p>Questions on senseUS are editorially selected by the senseUS team. They span seven categories: Fun, Hot Take, Deep, Topical, Current Events, Tracking, and Sponsored.</p>
        <p style={{ marginTop: '0.75rem' }}>Your feed starts with questions relevant to your country, since most people care most about what's close to home. If that pool runs low, we widen it automatically rather than leaving you with an empty feed.</p>
        <p style={{ marginTop: '0.75rem' }}>From there, questions rotate by category, taking turns one at a time rather than being weighted by how many questions exist in each — so every active category gets a fair turn in your feed. One side effect of that: a category with fewer live questions at a given moment isn't shown less often — if anything, each individual question in it tends to resurface a bit more, since it keeps coming back up in the rotation while a larger category has more competition to cycle through.</p>
        <p style={{ marginTop: '0.75rem' }}>Sponsored questions are asked on behalf of verified business partners, and are always clearly labeled. Sponsorship doesn't buy extra frequency or priority — a sponsored question takes its turn in the same fair rotation as everything else. What it does guarantee is visibility: unlike most other questions, Sponsored and Current Events questions aren't limited to your country, and we make sure they're included for you to see rather than leaving that to chance. The data from sponsored questions is subject to the same integrity protections as all other questions — sponsors cannot influence results, suppress answers, or receive individual user data.</p>
        <p style={{ marginTop: '0.75rem' }}>Tracking questions are asked periodically over time to measure how public opinion evolves on a given topic.</p>
      </Detail>

      <Detail title="The Make Up My Mind feature and article curation">
        <p>When you tap <strong>Make Up My Mind</strong>, you're taken to a curated list of articles on that question's topic. Articles are selected to represent the full spectrum: pro, neutral, and con perspectives.</p>
        <p style={{ marginTop: '0.75rem' }}>Articles are pre-loaded into our database before a question goes live — typically by AI-assisted research, reviewed by a human editor before publication.</p>
        <p style={{ marginTop: '0.75rem' }}>One important exception: for questions about artificial intelligence itself, articles are always selected by a human editor. AI systems never curate content about AI on senseUS. This is a hard rule encoded in our platform architecture, not just a policy.</p>
        <p style={{ marginTop: '0.75rem' }}>After reading, you return to the voting card to cast your vote. Make Up My Mind does not cast a vote on your behalf.</p>
      </Detail>

      <Detail title="How aggregate data works — what's protected and what's shared">
        <p>senseUS generates revenue by licensing aggregate opinion data to business customers. Here is exactly what that means:</p>
        <p style={{ marginTop: '0.75rem' }}><strong>What business customers receive:</strong> anonymized statistical summaries — for example, "68% of verified users aged 25–34 in the United States answered Yes to this question." These statistics are derived from anonymous internal account IDs and contain no personally identifiable information.</p>
        <p style={{ marginTop: '0.75rem' }}><strong>What business customers never receive:</strong> individual vote records, individual user profiles, phone numbers, names, or any data that could identify a specific person.</p>
        <p style={{ marginTop: '0.75rem' }}><strong>What we never do:</strong> sell your data to advertisers, build individual behavioral profiles for sale, or allow any external party to influence question results.</p>
      </Detail>

      <Detail title="Our AI policy">
        <p>senseUS uses AI in several ways: to help source and pre-load articles for the Make Up My Mind feature, to assist with question drafting, and for some content moderation.</p>
        <p style={{ marginTop: '0.75rem' }}>However, we have a strict conflict-of-interest rule: AI systems never generate, select, or solely moderate content about artificial intelligence itself. For any question touching on AI, all article selection and moderation escalations are handled by human editors.</p>
        <p style={{ marginTop: '0.75rem' }}>This policy is encoded in our platform architecture and subject to quarterly audit. It reflects our belief that AI should not be the one deciding how AI is perceived.</p>
      </Detail>

      <Detail title="Your data and your rights">
        <p>You can request a full export of your personal data at any time from your profile page. Exports are delivered within 48 hours — this delay is intentional, as a protection against real-time coercion.</p>
        <p style={{ marginTop: '0.75rem' }}>You can delete your account at any time. Deletion permanently removes your profile, all personally identifiable information, your votes, and your comments — nothing is retained. If you want your voice gone, it's gone entirely, not just disconnected from your name.</p>
        <p style={{ marginTop: '0.75rem' }}>For full details, see our <Link to="/privacy" style={{ color: '#2D3DCA', textDecoration: 'none' }}>Privacy Policy</Link>.</p>
      </Detail>

      <Detail title="Security and transparency">
        <p>senseUS undergoes third-party security audits on a regular schedule. A summary of audit findings is published in our biannual Transparency Report.</p>
        <p style={{ marginTop: '0.75rem' }}>Our database uses row-level security — meaning every query is restricted at the database level so users can only access their own data, regardless of how the application is configured.</p>
        <p style={{ marginTop: '0.75rem' }}>We publish our data architecture and security policies publicly. If you find a security vulnerability, please contact us at security@senseus.app.</p>
      </Detail>

      <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '1.5rem', marginTop: '3rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <Link to="/mission" style={{ fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}>Our Mission</Link>
         <Link to="/ethos" style={{ fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}>Our Ethos</Link>
        <Link to="/privacy" style={{ fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}>Privacy Policy</Link>
        <Link to="/terms" style={{ fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}>Terms of Service</Link>
      </div>

    </div>
  )
}
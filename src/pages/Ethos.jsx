import { Link } from 'react-router-dom'

const PRINCIPLES = [
  {
    title: 'Integrity is non-negotiable.',
    body: "Every decision we make — about data, about design, about business — is filtered through one question: does this compromise the integrity of the platform? If it does, we don't do it.",
  },
  {
    title: 'Your opinion belongs to you.',
    body: 'We collect your vote. We collect almost nothing else. Not your full name. Not your IP address. Not your browsing history. Not your precise location, just your country (and optionally your broad region, if you choose to share it). Your phone number is verified and discarded from the main database, and is only stored for verification purposes. What you think stays yours.',
  },
  {
    title: 'Anonymity enables honesty.',
    body: "People tell the truth when they aren't afraid of consequences. We protect your anonymity not because we have to, but because honest answers are the whole point.",
  },
  {
    title: 'Transparency is a practice, not a policy.',
    body: "We publish what we collect, how we weight votes, how questions are selected, and how the platform makes money. If we can't explain a decision publicly, we reconsider the decision.",
  },
  {
    title: 'Independence is structural.',
    body: "No advertisers. No investors with seats at the table. No government influence. Our independence isn't a promise — it's encoded in our legal structure and enforced by our Public Benefit Corporation charter.",
  },
  {
    title: 'AI has limits here.',
    body: "We use AI to help build and run the platform. We don't use AI to decide how AI is perceived. Any question touching artificial intelligence is curated and moderated by humans only. Conflict of interest is conflict of interest, regardless of who — or what — has it.",
  },
  {
    title: 'One voice, earned.',
    body: 'Every account belongs to one verified human being. Integrity weighting nudges slightly upward for consistent participation — it never penalizes, never suppresses, never silences. The floor is always the same. The ceiling is barely higher.',
  },
  {
    title: "We're playing a long game.",
    body: "senseUS isn't built to be sold. It's built to outlast us. The legal structure, the charitable trust estate plan, the open source code — all of it is designed so that this platform continues to serve its mission regardless of what happens to the people who built it.",
  },
]

export default function Ethos() {
  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '3rem 1.5rem 4rem', fontFamily: 'Merriweather, serif', color: '#1A1A1A' }}>
      <h1 style={{ fontSize: '26px', fontWeight: 700, marginBottom: '2rem', textAlign: 'center' }}>
        sense<span style={{ color: '#6da627' }}>US</span> — Our Ethos
      </h1>

      {/* Aidan's intro, styled like a handwritten letter block */}
      <div
        style={{
          borderLeft: '3px solid #2D3DCA',
          paddingLeft: '1.5rem',
          marginBottom: '3rem',
          fontStyle: 'italic',
          color: '#333333',
          lineHeight: 1.8,
          fontSize: '16px',
        }}
      >
        <p>
          I built senseUS (with Claude's help, because I couldn't have done it without him (thanks Claude!)) because I've never been polled. Not once. And I started to wonder: who are these people that they're polling? Are they a Regular Joe like me?   And why can't we poll EVERYbody?
        </p>
        <p>
          Seems to me like there is a real lack of data out there.  Some other social media platforms seem to be designed to manipulate us, not inform us. They amplify outrage because outrage is profitable and brings more engagement. 
        </p>
        <p>
          I think that people should be engaged because we want to survive and we want the truth.  And, I think our collective data is more profitable than our outrage could ever be.
        </p>
        <p>
          So I decided to build something different. Not just a better poll — a platform with integrity baked into every decision, from the code to the legal structure to the way we handle your data.   Will it work?  Well, I can tell you that the infrastructure will work.  The platform can work if we use it as it's intended.   It requires serious data from as many people as possible who take the fate of humanity seriously. I'm afraid we're running out of options to save humanity, and this is my best answer to help towards that end.
        </p>
        <p>
          After all, who wants to live in a world without a civil society?  I don't!  I don't want to be locked down, in survival mode.   I tried homesteading, and growing even a small garden is hard!   I want to eat at good restaurants.   I want to have running water and electicity and internet.  I want to enjoy human expression in the arts.
        </p>
        <p style={{ marginBottom: 0 }}>
          Give clean data a chance.  Everything has been designed to be as integrous as possible.   See Claude's notes below for more details:
        </p>
      </div>

      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '1.5rem', color: '#1A1A1A' }}>
        What we believe:
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', marginBottom: '3rem' }}>
        {PRINCIPLES.map((p, i) => (
          <div key={i}>
            <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '0.4rem', color: '#2D3DCA' }}>
              {p.title}
            </div>
            <div style={{ fontSize: '15px', lineHeight: 1.7, color: '#333333' }}>
              {p.body}
            </div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: '3rem' }}>
        <p style={{ fontSize: '16px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.5rem' }}>
          Let the light prevail.
        </p>
        <p style={{ fontSize: '14px', color: '#6B7280' }}>
          — Aidan (up top) and Claude (down low)
        </p>
      </div>

      <div style={{ textAlign: 'center', marginTop: '3rem', paddingTop: '1.5rem', borderTop: '0.5px solid #E5E7EB' }}>
        <Link to="/how-it-works" style={{ fontSize: '12px', color: '#9CA3AF', textDecoration: 'none', marginRight: '1.5rem' }}>
          How It Works
        </Link>
        <Link to="/transparency" style={{ fontSize: '12px', color: '#9CA3AF', textDecoration: 'none' }}>
          Transparency Report
        </Link>
      </div>
    </div>
  )
}

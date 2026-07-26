import { Link } from 'react-router-dom'

export default function Mission() {
  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '3rem 1.5rem', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '2.5rem' }}>
        <Link to="/" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none', }}>
          ← back
        </Link>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '28px', fontWeight: 500, color: '#1A1A1A', marginBottom: '4px' }}>
          sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
        </div>
         <h1 style={{ fontSize: '22px', fontWeight: 500, color: '#1A1A1A', margin: '0', }}>
          Our Mission
        </h1>
      </div>

      <div style={{ fontSize: '16px', lineHeight: 1.8, color: '#1A1A1A' }}>

        <p>senseUS was founded because we were tired of not knowing the truth.  And it is being founded as a PBC (Public Benefit Corporation), because we believed that senseUS could and <em>would</em> be of immense value to society.</p>
            
        <p>We're under the impression that we're living in an era of manufactured consensus. We think that some of the division of humanity doesn't really exist, and perhaps that contention that is driven intentionally. Bots have infected social media. Algorithms amplify outrage. Poll numbers get spun before the ink is dry.</p>

        <p>We're also under the impression that most people think for themselves; outside of party lines, beyond religious affiliations and are <em>way</em> more nuanced than any box that you could ever try to fit a human into.</p>
        
        <p>There is a real lack of data about humans in the world, and senseUS aims to fix that.</p>

        <p>So we built a platform where every voice belongs to a verified human being. One person, one account, one voice. No bots. No fake accounts. No coordinated manipulation. Just real people answering real questions, honestly, and anonymously. Because we believe that your opinion matters. Not an algorithm's version of it. Not a bot's approximation of it. Yours. And we believe that you shouldn't be afraid to voice it; in fact, you should be <em>encouraged</em> to voice it.</p>
        
        <p>We're all thrust into a society and are expected to get along, and we at senseUS think the most important thing you can do to be a functioning member of that society is to voice your opinions and thoughts on senseUS. Because you shouldn't let anyone tell you how you feel; <em>you</em> should tell <em>everyone</em> how <em>you</em> feel, in a very constructive, data-driven way.</p>

        <p>And for the questions where you're still making up your mind, we've curated articles from across the spectrum: pro, neutral, and con; so your opinion, when you give it, is an informed one.  We felt that, in addition to speaking your truth, senseUS should give you the opportunity to explore the truth as well.</p>

        <p>We believe that knowing what humanity actually thinks, without interference, is foundational to a functioning democracy.</p>

        <p>And besides, we're <em>really, really</em> curious what your answers are going to be to some of these.  We even have bets in place. ;)</p>

        <p style={{ marginTop: '2.5rem' }}>Let the light prevail.</p>

        <p style={{ marginTop: '1.5rem', fontSize: '15px', color: '#6B7280', }}>
          Sincerely,<br />
          <span style={{ color: '#1A1A1A', fontStyle: 'normal' }}>Aidan and Claude</span>
        </p>

      </div>

      <div style={{ borderTop: '0.5px solid #E5E7EB', marginTop: '3rem', paddingTop: '1.5rem', display: 'flex', gap: '1.5rem' }}>
        <a href="/privacy" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none', fontFamily: 'Arial, sans-serif' }}>Privacy Policy</a>
        <a href="/terms" style={{ fontSize: '11px', color: '#9CA3AF', textDecoration: 'none', fontFamily: 'Arial, sans-serif' }}>Terms of Service</a>
      </div>

    </div>
  )
}
import { useState, useEffect } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#2D3DCA', marginBottom: '0.75rem', paddingBottom: '6px', borderBottom: '1px solid #E5E7EB' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function StatCard({ label, value, note }) {
  return (
    <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
      <div style={{ fontSize: '28px', fontWeight: 700, color: '#2D3DCA', marginBottom: '4px' }}>{value}</div>
      <div style={{ fontSize: '12px', fontWeight: 500, color: '#1A1A1A', marginBottom: '2px' }}>{label}</div>
      {note && <div style={{ fontSize: '11px', color: '#6B7280' }}>{note}</div>}
    </div>
  )
}

function p(text, style = {}) {
  return <p style={{ fontSize: '14px', lineHeight: 1.8, color: '#374151', marginBottom: '0.75rem', ...style }}>{text}</p>
}

export default function Transparency() {
  usePageTitle('Transparency')
  const [stats, setStats] = useState({
    userCount: null,
    questionCount: null,
    voteCount: null,
    commentCount: null,
    updatedAt: null,
    events: [],
  })

  useEffect(() => {
    async function fetchStats() {
      try {
        // The four counts used to be `count: 'exact', head: true` queries
        // against profiles/questions/votes/comments — each a full scan
        // under the hood — recomputed synchronously on every visit to
        // this public, unauthenticated page. votes in particular is the
        // largest, fastest-growing table in the app, so this got linearly
        // slower as it grew, on a page with no rate limiting. It's now a
        // single read of a small cache table refreshed once a day by
        // refresh_transparency_stats() via pg_cron (see migration 024) —
        // exact-to-the-minute freshness isn't needed for a public "about
        // the numbers" page. transparency_events also picked up a limit;
        // it was previously fetched with no bound at all.
        const [statsRow, events] = await Promise.all([
          supabase.from('transparency_stats_cache').select('user_count, question_count, vote_count, comment_count, updated_at').maybeSingle(),
          supabase.from('transparency_events').select('*').eq('is_public', true).order('occurred_at', { ascending: false }).limit(100),
        ])
        setStats({
          userCount: statsRow.data?.user_count ?? 0,
          questionCount: statsRow.data?.question_count ?? 0,
          voteCount: statsRow.data?.vote_count ?? 0,
          commentCount: statsRow.data?.comment_count ?? 0,
          updatedAt: statsRow.data?.updated_at ?? null,
          events: events.data || [],
        })
      } catch (err) {
        console.error(err)
      }
    }
    fetchStats()
  }, [])

  const reportDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '3rem 1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '2rem' }}>
        <Link to="/" style={{ fontSize: '13px', color: '#2D3DCA', textDecoration: 'none' }}>← back</Link>
      </div>

      <div style={{ marginBottom: '2.5rem' }}>
        <div style={{ fontSize: '28px', fontWeight: 500, color: '#2D3DCA', marginBottom: '4px' }}>
          sense<span style={{ fontWeight: 700 }}>US</span>
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1A1A1A', margin: '0 0 8px' }}>
          Transparency Report
        </h1>
        <div style={{ fontSize: '13px', color: '#6B7280' }}>
          Version 1.0 — Published {reportDate}
        </div>
      </div>

      <div style={{ background: '#E6F1FB', border: '1px solid #0C447C', borderRadius: '8px', padding: '12px 16px', marginBottom: '2.5rem', fontSize: '13px', color: '#0C447C', lineHeight: 1.6 }}>
        senseUS is committed to radical transparency. This report documents what we collect, how we operate, and the decisions we've made — and why. We publish this not because we're required to, but because it's the right thing to do for a platform that asks people to trust it with their honest opinions.
      </div>

      {/* Section 1 */}
      <Section title="1. About This Report">
        {p("This is the first senseUS Transparency Report, published at launch. We commit to publishing updates every six months. Each report will document any changes to our data practices, platform policies, government requests received, and platform statistics.")}
        {p("This report is permanently available at senseus.app/transparency. Previous versions will be archived and linked here as the platform grows.")}
      </Section>

      {/* Section 2 */}
      <Section title="2. Who We Are">
        {p("senseUS is operated by Gudboi Enterprises, LLC, a Pennsylvania limited liability company. We are in the process of forming senseUS as a Delaware Public Benefit Corporation — a legal structure that formally commits the company to a public mission, not just profit.")}
        {p("Our mission: to create a trusted, bot-free source of truth for public opinion, independent of advertisers, investors, and governments.")}
        {p("We are a small team. senseUS was founded by Aidan Rosequist and built with the assistance of Claude, Anthropic's AI system — a collaboration we're transparent about because honesty about how we operate is fundamental to what senseUS is.")}
      </Section>

      {/* Section 3 */}
      <Section title="3. What We Collect — and What We Don't">
        <p style={{ fontSize: '14px', lineHeight: 1.8, color: '#374151', marginBottom: '0.75rem' }}>
          We designed senseUS from the ground up to collect as little personal information as possible. Every data point we store has a specific, documented purpose.
        </p>

        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', marginBottom: '6px' }}>What we collect:</div>
          <ul style={{ paddingLeft: '1.5rem', fontSize: '14px', lineHeight: 1.8, color: '#374151' }}>
            <li>Birth year (not full date of birth) — age verification only</li>
            <li>First name and last initial — display purposes only</li>
            <li>Phone number — stored by our authentication provider (Supabase) solely to enable future logins. Never stored in our application database, never used for marketing, never shared beyond what authentication requires.</li>
            <li>Country of residence (optional) — aggregate geographic analysis</li>
            <li>Votes — permanent, linked to anonymous internal ID only</li>
            <li>Comments and replies — displayed publicly under chosen display name</li>
            <li>Vote change history — timestamps only, for integrity scoring</li>
          </ul>
        </div>

        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', marginBottom: '6px' }}>What we deliberately do not collect:</div>
          <ul style={{ paddingLeft: '1.5rem', fontSize: '14px', lineHeight: 1.8, color: '#374151' }}>
            <li>Full date of birth</li>
            <li>Full last name</li>
            <li>Phone number in our application database (retained only by Supabase Auth for login purposes)</li>
            <li>Email address</li>
            <li>IP addresses</li>
            <li>Device fingerprints</li>
            <li>Location beyond country of residence</li>
            <li>Behavioral tracking or browsing history</li>
            <li>Gender, race, ethnicity, or religion</li>
          </ul>
        </div>
      </Section>

      {/* Section 4 */}
      <Section title="4. How Integrity Weighting Works">
        {p("Every senseUS account starts with an integrity weight of 1.0000. This weight can increase slightly — up to a maximum of 1.0050 — based on verified participation. Weights only go up; they never decrease as a penalty.")}
        {p("The current algorithm, recalculated daily:")}
        <div style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '1rem', marginBottom: '0.75rem' }}>
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6B7280', fontWeight: 500, borderBottom: '1px solid #E5E7EB' }}>Activity (last 30 days)</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#6B7280', fontWeight: 500, borderBottom: '1px solid #E5E7EB' }}>Weight added</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Baseline (verified account)', '+1.0000'],
                ['10+ votes', '+0.0005'],
                ['25+ votes', '+0.0010'],
                ['50+ votes', '+0.0020'],
                ['5+ comments', '+0.0005'],
                ['10+ comments', '+0.0005'],
                ['7+ day voting streak', '+0.0005'],
              ].map(([activity, weight]) => (
                <tr key={activity}>
                  <td style={{ padding: '6px 8px', color: '#374151', borderBottom: '0.5px solid #F3F4F6' }}>{activity}</td>
                  <td style={{ padding: '6px 8px', color: '#2D3DCA', fontWeight: 500, textAlign: 'right', borderBottom: '0.5px solid #F3F4F6' }}>{weight}</td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: '6px 8px', color: '#374151', fontWeight: 700 }}>Maximum possible</td>
                <td style={{ padding: '6px 8px', color: '#2D3DCA', fontWeight: 700, textAlign: 'right' }}>1.0050</td>
              </tr>
            </tbody>
          </table>
        </div>
        {p("This means that even the most active user's vote carries only 0.5% more weight than a brand new account. No individual voice is suppressed or silenced — the weighting exists solely to give verified long-term participation a slight edge over potential coordinated new-account manipulation.")}
      </Section>

      {/* Section 5 */}
      <Section title="5. How Questions Are Selected">
        {p("Questions are editorially selected by the senseUS team. We do not accept questions from users or the public at this time. Questions span six categories: Fun, Hot Take, Deep, Topical, Tracking, and Sponsored.")}
        {p("Tracking questions are asked periodically to measure how public opinion changes over time on specific issues. Sponsored questions are paid placements from verified business partners — they are clearly labeled, and sponsors cannot influence results or access individual user data.")}
        {p("Questions are served in a balanced rotation using stratified sampling based on the ratio of questions available in each category. No individual behavioral tracking or personalization is used — the queue is content-driven, not user-driven.")}
      </Section>

      {/* Section 6 */}
      <Section title="6. Our AI Policy">
        {p("senseUS uses AI in several ways: to assist with question drafting, to help source articles for the Make Up My Mind feature, and for some content moderation assistance.")}
        {p("We have one hard rule: AI systems never generate, select, curate, or solely moderate content about artificial intelligence itself. For any question touching on AI, all article selection and moderation escalations are handled by human editors. This policy is encoded in our platform architecture and subject to quarterly review.")}
        {p("We are also transparent that senseUS was built with significant assistance from Claude, Anthropic's AI system. Aidan Rosequist is the founder and decision-maker; Claude assisted with code, copy, and design — including co-authoring our mission statement. We believe this transparency is consistent with what senseUS stands for.")}
      </Section>

      {/* Section 7 */}
      <Section title="7. Data Licensing — What B2B Customers Get">
        {p("senseUS generates revenue by licensing aggregate opinion data to business customers. Here is exactly what that means:")}
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#4d621d', marginBottom: '4px' }}>What business customers receive:</div>
          <ul style={{ paddingLeft: '1.5rem', fontSize: '14px', lineHeight: 1.8, color: '#374151' }}>
            <li>Anonymized statistical summaries (e.g. "68% of verified users aged 25–34 in the US answered Yes")</li>
            <li>Aggregate trend data over time</li>
            <li>Demographic breakdowns at the aggregate level</li>
          </ul>
        </div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#7a1313', marginBottom: '4px' }}>What business customers never receive:</div>
          <ul style={{ paddingLeft: '1.5rem', fontSize: '14px', lineHeight: 1.8, color: '#374151' }}>
            <li>Individual vote records</li>
            <li>Individual user profiles</li>
            <li>Phone numbers, names, or any identifying information</li>
            <li>Any data that could identify a specific person</li>
          </ul>
        </div>
      </Section>

      {/* Section 8 */}
      <Section title="8. Security">
        {p("senseUS implements the following security measures:")}
        <ul style={{ paddingLeft: '1.5rem', fontSize: '14px', lineHeight: 1.8, color: '#374151', marginBottom: '0.75rem' }}>
          <li>Encryption in transit (HTTPS/TLS) on all connections</li>
          <li>Encryption at rest on all database storage</li>
          <li>Row-level security on every database table</li>
          <li>Service role credentials stored server-side only, never in client code</li>
          <li>Two-factor authentication on all platform accounts (Supabase, Vercel, GitHub, Twilio)</li>
          <li>Phone number discarded immediately after verification — not stored in the database</li>
          <li>No IP addresses logged</li>
        </ul>
        {p("We plan to conduct our first third-party security audit within 12 months of launch. Results will be summarized in our next transparency report.")}
        {p("Our authentication provider, Supabase, retains phone numbers solely to enable user login. In the event of a legal demand directed at either Gudboi Enterprises LLC or Supabase, both our application data and authentication data (including phone numbers) may be subject to disclosure. We are evaluating additional architectural separations in a future platform version to further protect user privacy.")}
        {p("To report a security vulnerability: security@senseus.app")}
      </Section>

      <Section title="9. Government Requests & Security Incidents">
        {(() => {
          const govRequests = stats.events.filter(e => e.event_type === 'government_request')
          const secIncidents = stats.events.filter(e => e.event_type === 'security_incident')
          return (
            <>
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', marginBottom: '8px' }}>Government Requests</div>
                {govRequests.length === 0 ? (
                  <p style={{ fontSize: '14px', lineHeight: 1.8, color: '#4d621d', fontWeight: 500, margin: '0 0 0.75rem' }}>
                    Zero government requests received to date.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '0.75rem' }}>
                    {govRequests.map(e => (
                      <div key={e.id} style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '12px' }}>
                        <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '4px' }}>{new Date(e.occurred_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                        <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.6, marginBottom: e.resolution ? '6px' : 0 }}>{e.description}</div>
                        {e.resolution && <div style={{ fontSize: '12px', color: '#52B788', marginTop: '4px' }}>Resolution: {e.resolution}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {p("If we ever receive a government request, we will notify affected users to the extent permitted by law, challenge requests we believe are overbroad or unlawful, and report the number and nature of requests here.")}
                {p("We note that because phone numbers are not stored after verification, and because votes are linked only to anonymous internal IDs, the data we could produce in response to a legal demand is extremely limited by design.")}
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A', marginBottom: '8px' }}>Security Incidents</div>
                {secIncidents.length === 0 ? (
                  <p style={{ fontSize: '14px', lineHeight: 1.8, color: '#4d621d', fontWeight: 500, margin: 0 }}>
                    Zero security incidents to date.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {secIncidents.map(e => (
                      <div key={e.id} style={{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: '8px', padding: '12px' }}>
                        <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '4px' }}>{new Date(e.occurred_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                        <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.6, marginBottom: e.resolution ? '6px' : 0 }}>{e.description}</div>
                        {e.resolution && <div style={{ fontSize: '12px', color: '#52B788', marginTop: '4px' }}>Resolution: {e.resolution}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )
        })()}
      </Section>

      {/* Section 10 — Live stats */}
      <Section title="10. Platform Statistics">
        <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '1rem' }}>
          These numbers come directly from our database and are refreshed daily.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '1rem' }}>
          <StatCard
            label="Verified users"
            value={stats.userCount !== null ? stats.userCount.toLocaleString() : '—'}
            note="Accounts created"
          />
          <StatCard
            label="Questions published"
            value={stats.questionCount !== null ? stats.questionCount.toLocaleString() : '—'}
            note="Active on platform"
          />
          <StatCard
            label="Votes cast"
            value={stats.voteCount !== null ? stats.voteCount.toLocaleString() : '—'}
            note="Total responses"
          />
          <StatCard
            label="Comments posted"
            value={stats.commentCount !== null ? stats.commentCount.toLocaleString() : '—'}
            note="In conversations"
          />
        </div>
        {stats.updatedAt && (
          <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '1rem' }}>
            Figures above as of {new Date(stats.updatedAt).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} — refreshed daily.
          </div>
        )}
        {p(`Government requests received: ${stats.events.filter(e => e.event_type === 'government_request').length}`, { color: '#4d621d', fontWeight: 500 })}
        {p(`Security incidents: ${stats.events.filter(e => e.event_type === 'security_incident').length}`, { color: '#4d621d', fontWeight: 500 })}
        {p("Third-party audits completed: 0 (first audit planned within 12 months of launch)", { color: '#6B7280' })}
      </Section>

      {/* Section 11 */}
      <Section title="11. What's Coming">
        <ul style={{ paddingLeft: '1.5rem', fontSize: '14px', lineHeight: 1.8, color: '#374151' }}>
          <li>Delaware Public Benefit Corporation formation — in progress</li>
          <li>Trademark registration for "senseUS" — in progress</li>
          <li>B Corp certification — planned approximately 1 year post-launch</li>
          <li>First third-party security audit — planned within 12 months of launch</li>
          <li>senseUS Youth platform — planned, with age-appropriate privacy protections and parental consent</li>
          <li>Native mobile apps (iOS and Android) — planned post-launch</li>
        </ul>
      </Section>

      {/* Footer */}
      <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '1.5rem', marginTop: '2rem' }}>
        <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '1rem' }}>
          Questions about this report? Contact us at privacy@senseus.app
        </p>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <Link to="/privacy" style={{ fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}>Privacy Policy</Link>
          <Link to="/terms" style={{ fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}>Terms of Service</Link>
          <Link to="/mission" style={{ fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}>Our Mission</Link>
          <Link to="/ethos" style={{ fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}>Our Ethos</Link>
          <Link to="/how-it-works" style={{ fontSize: '12px', color: '#6B7280', textDecoration: 'none' }}>How It Works</Link>
        </div>
      </div>

    </div>
  )
}
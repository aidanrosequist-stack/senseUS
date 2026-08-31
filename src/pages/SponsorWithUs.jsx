import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { supabase } from '../lib/supabase'

// NOTE: this page is intentionally NOT linked from navigation anywhere.
// It's reachable directly at /sponsor for sending to potential sponsors
// ahead of Phase 2 (user-suggested questions), when it launches visibly.
//
// SCOPE (2026-08-26): this is the pricing/informational page plus a
// lightweight "get in touch" inquiry form. It deliberately does NOT
// implement the $150-deposit application flow, Stripe charges, or the
// DocuSign e-signature contract pipeline described alongside this ask —
// that's being held off for a later pass. Submitting the form below
// creates a row in sponsorship_inquiries for manual follow-up (a
// spreadsheet-equivalent, reviewed by an admin) — no card is collected,
// nothing here charges anyone.

// Regions are a sub-selection within a country, not a parallel tier —
// only US has any defined today. A country with no entry here just
// doesn't offer a region narrowing option on the page.
const REGIONS_BY_COUNTRY = {
  US: ['Northeast', 'Midwest', 'South', 'West'],
}
const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'JP', name: 'Japan' },
  { code: 'BR', name: 'Brazil' },
  { code: 'IN', name: 'India' },
  { code: 'MX', name: 'Mexico' },
]
const SPONSOR_CATEGORIES = [
  { value: 'brand', label: 'Brand' },
  { value: 'research', label: 'Research' },
  { value: 'ngo', label: 'NGO / nonprofit' },
  { value: 'media', label: 'Media' },
  { value: 'government', label: 'Government' },
  { value: 'political', label: 'Political' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'technology', label: 'Technology' },
  { value: 'other', label: 'Other' },
]

const FLOOR_PRICE = { region: 1500, country: 5000, global: 10000 }
const CUSTOM_CONTENT_FEE = 500
const DEPOSIT = 150
const MAX_WEEKS = 4
const EXTENSION_DISCOUNT = 0.35

// Flat weekly blocks, not a per-day rate. The first 7 days is always
// the base price, full stop. Every week after that — 2, 3, or 4 — is a
// full extra week at a flat 35% off the base weekly price; 35% is a
// cap, not a starting point that grows for longer runs, which is also
// why run length is capped at 4 weeks for now.
function totalPriceForWeeks(basePrice, weeks) {
  let total = basePrice
  for (let w = 2; w <= weeks; w++) {
    total += basePrice * (1 - EXTENSION_DISCOUNT)
  }
  return total
}

function formatUSD(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

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

function StatTile({ label, value }) {
  return (
    <div style={{ flex: '1 1 140px', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '14px 16px', background: '#FAFAFA' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: '#1A1A1A' }}>{value}</div>
    </div>
  )
}

const selectStyle = { fontSize: '13px', color: '#1A1A1A', border: '1px solid #D1D5DB', borderRadius: '6px', padding: '6px 8px', fontFamily: 'Merriweather, serif', background: 'white', width: '100%', boxSizing: 'border-box' }
const labelStyle = { fontSize: '12px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px', display: 'block' }
const inputStyle = { ...selectStyle }

export default function SponsorWithUs() {
  usePageTitle('Sponsor a Question')

  const [counts, setCounts] = useState(null)
  const [countsError, setCountsError] = useState(null)

  const [tier, setTier] = useState('global')
  const [region, setRegion] = useState(null)
  const [countryCode, setCountryCode] = useState('US')

  // Independent from the pricing calculator's own tier/region/country
  // state above — this is just for browsing reach numbers, so picking a
  // country here doesn't also change what you're pricing out below.
  const [reachCountry, setReachCountry] = useState('US')
  const [weeks, setWeeks] = useState(1)
  const [wantsCustomContent, setWantsCustomContent] = useState(false)

  const [form, setForm] = useState({ name: '', email: '', company: '', category: 'brand', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadCounts() {
      const { data, error } = await supabase.rpc('get_sponsorship_reach_counts')
      if (cancelled) return
      if (error) {
        setCountsError(error.message)
      } else {
        setCounts(data)
      }
    }
    loadCounts()
    return () => { cancelled = true }
  }, [])

  const basePrice = FLOOR_PRICE[tier]
  const total = totalPriceForWeeks(basePrice, weeks) + (wantsCustomContent ? CUSTOM_CONTENT_FEE : 0)

  const scopeCount =
    tier === 'global' ? counts?.global
    : tier === 'region' ? counts?.by_region?.[region]
    : counts?.by_country?.[countryCode]

  const scopeLabel =
    tier === 'global' ? 'registered users, globally'
    : tier === 'region' ? `registered users in ${region}`
    : `registered users in ${COUNTRIES.find(c => c.code === countryCode)?.name || countryCode}`

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    if (!form.name.trim() || !form.email.trim()) {
      setSubmitError('Name and email are required.')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('sponsorship_inquiries').insert({
      name: form.name.trim(),
      email: form.email.trim(),
      company: form.company.trim() || null,
      tier,
      region: tier === 'region' ? region : null,
      // A region is always a sub-selection within a country (see
      // REGIONS_BY_COUNTRY above), so a region-tier inquiry should carry
      // its country too, not just the region name — otherwise a future
      // country with its own regions would make a stored "Northeast"
      // ambiguous about which country it belongs to.
      country_code: (tier === 'country' || tier === 'region') ? countryCode : null,
      category: form.category,
      wants_custom_content: wantsCustomContent,
      message: form.message.trim() || null,
    })
    setSubmitting(false)
    if (error) {
      setSubmitError('Something went wrong submitting this — ' + error.message)
      return
    }
    setSubmitted(true)
  }

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
          Sponsor a Question
        </h1>
      </div>

      <Section title="What sponsorship is">
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151', marginBottom: '1rem' }}>
          A sponsored question runs in the normal senseUS voting feed alongside everything else, clearly labeled "Sponsored by [your name]." It's open to companies and individuals alike — same application, same pricing, same disclosure requirement. There's no separate track for a bigger brand versus a person asking a question that matters to them.
        </p>
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151' }}>
          Political questions are priced the same as every other category — no discount, no markup. Access for smaller or newer political voices isn't protected by price; it's protected by a hard cap we enforce at the database level on how many political sponsorships can run at once, so one large buyer can't simply outspend everyone else out of the category.
        </p>
      </Section>

      <Section title="Rules of engagement">
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151', marginBottom: '1rem' }}>
          A sponsored question is a question first — it goes through the same content standards every question on senseUS does. Debate about ideas, culture, and public affairs is welcome, including sharp or provocative framing. What isn't permitted:
        </p>
        <ul style={{ fontSize: '15px', lineHeight: 1.9, color: '#374151', marginBottom: '1rem', paddingLeft: '1.25rem' }}>
          <li>Hate speech, harassment, or discriminatory content, regardless of the viewpoint expressed</li>
          <li>Content targeting a person's identity — race, ethnicity, gender, religion, sexual orientation, or disability</li>
          <li>Content that violates any applicable law</li>
          <li>Anything designed to manipulate vote outcomes rather than ask a genuine question</li>
        </ul>
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151' }}>
          This is the standard a rejection falls under when it costs the deposit rather than refunds it (see Deposit &amp; process below). Full legal terms are in our <Link to="/terms" style={{ color: '#2D3DCA', textDecoration: 'none' }}>Terms of Service</Link>.
        </p>
      </Section>

      <Section title="Live reach">
        {countsError && (
          <p style={{ fontSize: '13px', color: '#B91C1C' }}>Couldn't load live counts right now ({countsError}).</p>
        )}
        {!countsError && !counts && (
          <p style={{ fontSize: '13px', color: '#6B7280' }}>Loading live counts…</p>
        )}
        {counts && (
          <>
            {/* Global — full width, top-level, matches the Pricing layout below */}
            <div style={{ borderRadius: '10px', padding: '14px 16px', marginBottom: '10px', boxSizing: 'border-box', border: '0.5px solid #E5E7EB', background: '#FAFAFA' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Global</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#1A1A1A' }}>{(counts.global || 0).toLocaleString()} registered users</div>
            </div>

            {/* Country — dropdown; regions (if any exist for that country) populate underneath */}
            <div style={{ borderRadius: '10px', padding: '14px 16px', boxSizing: 'border-box', border: '0.5px solid #E5E7EB', background: '#FAFAFA' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Country</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#1A1A1A' }}>{(counts.by_country?.[reachCountry] || 0).toLocaleString()}</div>
              </div>
              <select style={selectStyle} value={reachCountry} onChange={e => setReachCountry(e.target.value)}>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>

              {REGIONS_BY_COUNTRY[reachCountry] && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                  {REGIONS_BY_COUNTRY[reachCountry].map(r => (
                    <StatTile key={r} label={r} value={(counts.by_region?.[r] || 0).toLocaleString()} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '10px', lineHeight: 1.6 }}>
          Region counts reflect users who've set a region in their profile — region is optional, so this understates true regional reach rather than overstating it.
        </p>
      </Section>

      <Section title="Pricing">
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151', marginBottom: '1rem' }}>
          Three reach tiers, each with a flat starting price for a 7-day run. Pick a tier below to see the live headcount it currently reaches and the total price for your run length.
        </p>

        {/* Global — full width, top-level, its own tier */}
        <button
          onClick={() => setTier('global')}
          style={{
            display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', borderRadius: '10px',
            padding: '14px 16px', marginBottom: '10px', boxSizing: 'border-box',
            border: tier === 'global' ? '1.5px solid #2D3DCA' : '0.5px solid #E5E7EB',
            background: tier === 'global' ? '#EEF0FD' : 'white',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>Global</div>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>{formatUSD(FLOOR_PRICE.global)}</div>
        </button>

        {/* Country — always-visible dropdown; picking one selects that
            country's tier. Regions (if any exist for that country)
            populate underneath as a further narrowing, not a separate
            top-level tier. */}
        <div
          style={{
            borderRadius: '10px', padding: '14px 16px', marginBottom: '1rem', boxSizing: 'border-box',
            border: (tier === 'country' || tier === 'region') ? '1.5px solid #2D3DCA' : '0.5px solid #E5E7EB',
            background: (tier === 'country' || tier === 'region') ? '#EEF0FD' : 'white',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>Country</div>
            <div style={{ fontSize: '12px', color: '#6B7280' }}>{formatUSD(FLOOR_PRICE.country)}</div>
          </div>
          <select
            style={selectStyle}
            value={countryCode}
            onChange={e => { setCountryCode(e.target.value); setTier('country'); setRegion(null) }}
          >
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>

          {REGIONS_BY_COUNTRY[countryCode] && (
            <div style={{ marginTop: '12px' }}>
              <label style={labelStyle}>Narrow to a region (optional) — {formatUSD(FLOOR_PRICE.region)}</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setTier('country'); setRegion(null) }}
                  style={{
                    padding: '6px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                    border: tier === 'country' ? '1.5px solid #2D3DCA' : '1px solid #D1D5DB',
                    background: tier === 'country' ? '#2D3DCA' : 'white',
                    color: tier === 'country' ? 'white' : '#374151',
                  }}
                >
                  All of {COUNTRIES.find(c => c.code === countryCode)?.name}
                </button>
                {REGIONS_BY_COUNTRY[countryCode].map(r => (
                  <button
                    key={r}
                    onClick={() => { setTier('region'); setRegion(r) }}
                    style={{
                      padding: '6px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                      border: (tier === 'region' && region === r) ? '1.5px solid #2D3DCA' : '1px solid #D1D5DB',
                      background: (tier === 'region' && region === r) ? '#2D3DCA' : 'white',
                      color: (tier === 'region' && region === r) ? 'white' : '#374151',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>Run length (4-week maximum for now)</label>
          <select style={selectStyle} value={weeks} onChange={e => setWeeks(parseInt(e.target.value, 10))}>
            <option value={1}>1 week (7 days) — base price</option>
            <option value={2}>2 weeks (14 days) — week 2 at 35% off</option>
            <option value={3}>3 weeks (21 days) — weeks 2–3 at 35% off</option>
            <option value={4}>4 weeks (28 days) — weeks 2–4 at 35% off</option>
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', marginBottom: '1rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={wantsCustomContent} onChange={e => setWantsCustomContent(e.target.checked)} />
          I'll supply my own articles/content for Make Up My Mind (+{formatUSD(CUSTOM_CONTENT_FEE)} for editorial review)
        </label>

        <div style={{ border: '1px solid #2D3DCA', borderRadius: '10px', padding: '16px', background: '#EEF0FD' }}>
          <div style={{ fontSize: '13px', color: '#374151', marginBottom: '4px' }}>
            {tier === 'region' ? `Region: ${region}` : tier === 'country' ? `Country: ${COUNTRIES.find(c => c.code === countryCode)?.name}` : 'Global'}
            {' · '}{weeks} week{weeks > 1 ? 's' : ''}
            {wantsCustomContent ? ' · custom content' : ''}
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#1A1A1A' }}>{formatUSD(total)}</div>
          <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
            {counts ? `Currently reaches ~${(scopeCount || 0).toLocaleString()} ${scopeLabel}` : 'Loading current reach…'}
          </div>
        </div>
      </Section>

      <Section title="Deposit & process">
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151', marginBottom: '1rem' }}>
          A flat {formatUSD(DEPOSIT)} deposit — the same for every tier, since reviewing an application doesn't get harder with a bigger budget — is collected when you submit a question for review. If we can't run it for an ordinary reason (it doesn't fit our format, needs rework), the deposit is fully refunded. If it's rejected specifically for violating a platform rule, the deposit is forfeited.
        </p>
        <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#374151' }}>
          From there: we review and respond, a short contract is signed, half of the remaining balance is collected, your question runs for the paid duration, and results are delivered along with the final invoice.
        </p>
      </Section>

      <Section title="Get in touch">
        {submitted ? (
          <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#1A1A1A' }}>
            Thanks — we've got your details and will follow up by email. Nothing has been charged.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '1rem', lineHeight: 1.6 }}>
              This isn't a payment form — it just lets us know you're interested, so we can follow up directly. No card is collected here.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input style={inputStyle} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input type="email" style={inputStyle} value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={labelStyle}>Company (optional)</label>
                <input style={inputStyle} value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Category</label>
                <select style={selectStyle} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  {SPONSOR_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>Message (optional)</label>
              <textarea
                style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }}
                value={form.message}
                onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                placeholder="What's the question you'd like to sponsor?"
              />
            </div>
            {submitError && (
              <p style={{ fontSize: '13px', color: '#B91C1C', marginBottom: '10px' }}>{submitError}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              style={{ background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: 700, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? 'Submitting…' : `Submit interest — ${tier === 'region' ? region : tier === 'country' ? COUNTRIES.find(c => c.code === countryCode)?.name : 'Global'}, ${weeks} week${weeks > 1 ? 's' : ''} (${formatUSD(total)})`}
            </button>
          </form>
        )}
      </Section>

    </div>
  )
}

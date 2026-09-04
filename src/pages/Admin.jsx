import { useState, useEffect } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAdmin } from '../hooks/useAdmin'
import AdminReports from './AdminReports'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const CATEGORIES = ['fun', 'hot take', 'deep', 'topical', 'sponsored', 'current events']
const DOMAINS = ['society & culture', 'ethics & philosophy', 'health & wellbeing', 'relationships', 'technology', 'money & work', 'media & information', 'politics & policy', 'science & nature', 'sports & leisure']
const STANCES = ['yes', 'ly', 'neutral', 'ln', 'no']

function Tab({ label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        background: active ? '#2D3DCA' : 'transparent',
        color: active ? 'white' : '#6B7280',
        border: 'none',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'Merriweather, serif',
        position: 'relative',
      }}
    >
      {label}
      {badge > 0 && (
        <span style={{
          position: 'absolute', top: '-4px', right: '-4px',
          background: '#c21f1f', color: 'white', borderRadius: '10px',
          fontSize: '10px', fontWeight: 700, padding: '1px 5px', minWidth: '16px',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
}

// A sponsorship progression milestone (migration 047) is just a
// timestamp — set means it happened, null means it hasn't. Clicking an
// unset pill stamps now(); clicking a set one clears it, in case it was
// marked by mistake.
function MilestonePill({ label, value, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px', borderRadius: '20px', fontSize: '11px', cursor: 'pointer', fontFamily: 'Merriweather, serif',
        border: value ? '1px solid #4d621d' : '1px solid #D1D5DB',
        background: value ? '#eef3e0' : 'white',
        color: value ? '#4d621d' : '#6B7280',
      }}
    >
      {value ? `${label} · ${new Date(value).toLocaleDateString()}` : `Mark ${label.toLowerCase()}`}
    </button>
  )
}

export default function Admin() {
  usePageTitle('Admin')
  const { isAdmin, loading } = useAdmin()
  const navigate = useNavigate()
  const [tab, setTab] = useState('questions')
  const [questions, setQuestions] = useState([])
  // Questions tab search (admin_search_questions RPC, migration 048).
  // Kept entirely separate from `questions` above -- that array is capped
  // at the 500 most-recently-created rows and is also read by the Add
  // article tab's question picker, so search results live in their own
  // state rather than filtering/replacing it. Mirrors the debounced
  // search pattern already used in Explore.jsx, but against the
  // admin-only RPC so drafts and archived questions are searchable too.
  const [questionSearchQuery, setQuestionSearchQuery] = useState('')
  const [questionSearchResults, setQuestionSearchResults] = useState([])
  const [searchingQuestions, setSearchingQuestions] = useState(false)
  const [loadingData, setLoadingData] = useState(false)
  const [message, setMessage] = useState(null)
  const [flaggedComments, setFlaggedComments] = useState([])
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [unresolvedCount, setUnresolvedCount] = useState(0)
  const [registrationOpen, setRegistrationOpen] = useState(true)

  /* eslint-disable-next-line react-hooks/set-state-in-effect -- async settings fetch; result genuinely unknown until the query resolves */
  useEffect(() => {
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'registration_open')
      .single()
      .then(({ data }) => setRegistrationOpen(data?.value !== false))
  }, [])

  // New question form
  const [newQuestion, setNewQuestion] = useState({
    text: '',
    category: 'deep',
    domain: 'ethics & philosophy',
    geo_scope: 'global',
    country_code: '',
    human_moderation_required: false,
    ai_question: false,
    is_current_event: false,
    archive_at: '',
  })

  // New article form
  const [flaggedQuestions, setFlaggedQuestions] = useState([])
  const [loadingFlagged, setLoadingFlagged] = useState(false)
  const [newEvent, setNewEvent] = useState({
    event_type: 'government_request',
    occurred_at: new Date().toISOString().split('T')[0],
    description: '',
    resolution: '',
    is_public: true,
  })
  const [selectedQuestionId, setSelectedQuestionId] = useState('')
  const [newArticle, setNewArticle] = useState({
    url: '',
    title: '',
    outlet_name: '',
    stance: 'neutral',
    display_order: 1,
    human_curated: true,
    ai_excluded: false,
  })

  const [broadcast, setBroadcast] = useState({
    title: '',
    body: '',
    type: 'admin_broadcast',
    priority: 'normal',
    action_url: '',
    audience: 'all',
    country_code: '',
    age_min: '',
    age_max: '',
  })
  const [broadcasting, setBroadcasting] = useState(false)
  const [sponsoredQueue, setSponsoredQueue] = useState([])
  const [sponsorshipInquiries, setSponsorshipInquiries] = useState([])
  const [newSponsor, setNewSponsor] = useState({
    question_number: '',
    sponsor_name: '',
    sponsor_contact: '',
    sponsor_category: 'brand',
    duration_days: 30,
  })

  async function loadSponsoredQueue() {
    const { data, error } = await supabase
      .from('sponsored_queue')
      .select('*')
    if (error) {
      // Previously silent: this dropped `error` entirely, so a missing
      // view or an RLS denial looked identical to "no sponsorships yet"
      // — which is exactly how a genuinely live sponsored question went
      // unnoticed here. Surface it instead.
      showMessage('Error loading sponsored queue: ' + error.message, true)
      return
    }
    setSponsoredQueue(data || [])
  }

  // Inquiries from the (unlinked, pre-Phase-2) /sponsor pricing page's
  // "get in touch" form. This is intentionally the low-commitment path
  // -- no deposit, no card, no contract yet -- so this is a review/status
  // list, not an approve/reject flow like the sponsored questions queue
  // above. See migration 046.
  async function loadSponsorshipInquiries() {
    const { data, error } = await supabase
      .from('sponsorship_inquiries')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      showMessage('Error loading sponsorship inquiries: ' + error.message, true)
      return
    }
    setSponsorshipInquiries(data || [])
  }

  async function updateInquiryStatus(id, status) {
    const { error } = await supabase
      .from('sponsorship_inquiries')
      .update({ status })
      .eq('id', id)
    if (error) {
      showMessage('Error updating inquiry: ' + error.message, true)
      return
    }
    loadSponsorshipInquiries()
  }

  useEffect(() => {
    if (loading) return
    if (!isAdmin) {
      navigate('/')
    }
  }, [isAdmin, loading])

  useEffect(() => {
    if (isAdmin) {
      loadQuestions()
      loadFlaggedQuestions()
      loadFlaggedComments()
      loadSponsoredQueue()
      loadSponsorshipInquiries()
    }
  }, [isAdmin])

  /* eslint-disable react-hooks/set-state-in-effect -- async count polled on an interval; inherently can't be derived during render */
  useEffect(() => {
    if (!isAdmin) return
    async function loadUnresolvedCount() {
      const { count } = await supabase
        .from('anomaly_log')
        .select('*', { count: 'exact', head: true })
        .eq('resolved', false)
      setUnresolvedCount(count || 0)
    }
    loadUnresolvedCount()
    const interval = setInterval(loadUnresolvedCount, 60000)
    return () => clearInterval(interval)
  }, [isAdmin])
  /* eslint-enable react-hooks/set-state-in-effect */

async function createSponsorship() {
    if (!newSponsor.question_number || !newSponsor.sponsor_name) {
      return showMessage('Question number and sponsor name are required.', true)
    }

    const { data: question, error: qError } = await supabase
      .from('questions')
      .select('id')
      .eq('question_number', parseInt(newSponsor.question_number, 10))
      .single()

    if (qError || !question) {
      return showMessage('No question found with that number.', true)
    }

    const { error } = await supabase.from('sponsored_questions').insert({
      question_id: question.id,
      sponsor_name: newSponsor.sponsor_name,
      sponsor_contact: newSponsor.sponsor_contact || null,
      sponsor_category: newSponsor.sponsor_category,
      duration_days: parseInt(newSponsor.duration_days, 10) || 30,
    })

    if (error) {
      showMessage('Error creating sponsorship: ' + error.message, true)
      return
    }

    showMessage('Sponsorship request added to the queue.')
    setNewSponsor({ question_number: '', sponsor_name: '', sponsor_contact: '', sponsor_category: 'brand', duration_days: 30 })
    loadSponsoredQueue()
  }

  async function activateSponsorship(id) {
    const { error } = await supabase.rpc('activate_sponsored_question', { p_sponsored_id: id })
    if (error) {
      showMessage(error.message, true)
      return
    }
    showMessage('Sponsorship activated — question is now live.')
    loadSponsoredQueue()
  }

  // Generic toggle for the plain progression timestamps (migration 047)
  // — each one just means "this happened at this time", so a click sets
  // it to now() and a second click on an already-set milestone clears
  // it back to null, in case it was marked by mistake.
  async function toggleMilestone(row, field) {
    const { error } = await supabase
      .from('sponsored_questions')
      .update({ [field]: row[field] ? null : new Date().toISOString() })
      .eq('id', row.id)
    if (error) {
      showMessage('Error updating: ' + error.message, true)
      return
    }
    loadSponsoredQueue()
  }

  // Two distinct reasons, not one — matches the deposit refund/forfeit
  // split. Forfeiture needs no further action, so it's stamped
  // immediately; a refund is a real payment action that still has to
  // happen, so that stays a separate milestone (toggleMilestone above)
  // marked once it's actually been sent.
  async function rejectSponsorship(id, reason) {
    let rejection_rule_detail = null
    if (reason === 'rule_violation') {
      rejection_rule_detail = window.prompt('Which rule was violated? (required — this is recorded with the rejection)')
      if (!rejection_rule_detail || !rejection_rule_detail.trim()) {
        showMessage('A rule-violation rejection requires stating which rule was broken.', true)
        return
      }
    }
    const updates = {
      status: 'rejected',
      rejection_reason: reason,
      rejection_rule_detail,
      deposit_forfeited_at: reason === 'rule_violation' ? new Date().toISOString() : null,
    }
    const { error } = await supabase.from('sponsored_questions').update(updates).eq('id', id)
    if (error) {
      showMessage('Error rejecting: ' + error.message, true)
      return
    }
    showMessage(reason === 'doesnt_fit' ? "Rejected — deposit refund still needs to be sent, then marked below." : 'Rejected — deposit forfeited.')
    loadSponsoredQueue()
  }

async function toggleRegistration(open) {
    const { error } = await supabase
      .from('app_settings')
      .update({ value: open, updated_at: new Date().toISOString() })
      .eq('key', 'registration_open')
    if (error) {
      showMessage('Error updating registration status: ' + error.message, true)
      return
    }
    setRegistrationOpen(open)
    showMessage(open ? 'Registration is now open.' : 'Registration is now closed.')
    // Best-effort — an audit-log write failing shouldn't block or roll
    // back an admin action that already succeeded.
    supabase.rpc('log_admin_action', { p_action_type: open ? 'open_registration' : 'close_registration' })
      .then(({ error }) => { if (error) console.error('log_admin_action failed', error) })
  }

  async function loadQuestions() {
    setLoadingData(true)
    // Capped at 500 — this was previously unbounded, and it's re-run after
    // nearly every admin mutation (add/publish/delete/edit), so every edit
    // round-tripped and re-rendered the entire growing list. A full switch
    // to optimistic local updates (never refetching at all) would touch
    // every mutation handler below; capping the fetch is the lower-risk fix
    // for now and still bounds the worst case.
    const { data, error } = await supabase
      .from('questions')
      .select('id, text, category, domain, published_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (!error) setQuestions(data || [])
    setLoadingData(false)
  }

  // Debounced Questions-tab search against the admin-only RPC (migration
  // 048) -- searches the full table (drafts, archived, everything) by
  // text/category/domain, not just the 500-row window loadQuestions()
  // keeps in `questions`. Empty query means "show the normal list";
  // results here never touch `questions` itself.
  useEffect(() => {
    const trimmed = questionSearchQuery.trim()
    if (!trimmed) {
      setQuestionSearchResults([])
      setSearchingQuestions(false)
      return
    }

    let ignore = false
    setSearchingQuestions(true)
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('admin_search_questions', { p_query: trimmed })
      if (ignore) return
      if (error) {
        showMessage('Search error: ' + error.message, true)
        setQuestionSearchResults([])
      } else {
        setQuestionSearchResults(data || [])
      }
      setSearchingQuestions(false)
    }, 300)

    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [questionSearchQuery])

  async function loadFlaggedQuestions() {
    setLoadingFlagged(true)
    const { data, error } = await supabase
      .from('questions')
      .select('id, text, category, domain, published_at, human_moderation_required')
      .eq('human_moderation_required', true)
      .is('published_at', null)
      .order('created_at', { ascending: false })
    if (!error) setFlaggedQuestions(data || [])
    setLoadingFlagged(false)
  }

  async function loadFlaggedComments() {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        id, body, flag_count, created_at,
        profiles (first_name, last_initial, display_preference, anon_name),
        questions (text, question_number)
      `)
      .eq('is_flagged', true)
      .eq('is_deleted', false)
      .order('flag_count', { ascending: false })
    if (!error) setFlaggedComments(data || [])
  }

  function showMessage(msg, isError = false) {
    setMessage({ text: msg, isError })
    setTimeout(() => setMessage(null), 3000)
  }

  async function addQuestion() {
    if (!newQuestion.text.trim()) return showMessage('Question text is required.', true)
      if ((newQuestion.geo_scope === 'country' || newQuestion.geo_scope === 'regional') && !newQuestion.country_code) {
      return showMessage('Please select a target country for this scope.', true)
    }
    const { error } = await supabase.from('questions').insert({
      ...newQuestion,
      // archive_at is a timestamptz column — an empty string (the form's
      // default when "Current event" isn't checked) fails Postgres with
      // `invalid input syntax for type timestamp with time zone: ""`.
      // Send null instead so the column stays genuinely unset.
      archive_at: newQuestion.archive_at ? newQuestion.archive_at : null,
      published_at: new Date().toISOString(),
    })
    if (error) {
      showMessage('Error adding question: ' + error.message, true)
    } else {
      showMessage('Question added!')
      setNewQuestion({ text: '', category: 'deep', domain: 'ethics & philosophy', geo_scope: 'global', country_code: '', human_moderation_required: false, ai_question: false, is_current_event: false, archive_at: '' })
      loadQuestions()
    }
  }

  async function togglePublish(question) {
    const wasPublished = !!question.published_at
    const { error } = await supabase
      .from('questions')
      .update({ published_at: wasPublished ? null : new Date().toISOString() })
      .eq('id', question.id)
    if (!error) {
      showMessage(wasPublished ? 'Question unpublished.' : 'Question published!')
      loadQuestions()
      supabase.rpc('log_admin_action', {
        p_action_type: wasPublished ? 'unpublish_question' : 'publish_question',
        p_target_type: 'question',
        p_target_id: question.id,
      }).then(({ error }) => { if (error) console.error('log_admin_action failed', error) })
    }
  }

  async function pushAsBreakingNews(q) {
    // A plain count — bypasses the same 1000-row cap that used to bite the
    // actual broadcast below, since count:'exact',head:true asks Postgres
    // for a row count rather than returning rows themselves. Used only to
    // show the admin an accurate number before they confirm.
    const { count: userCount, error: countError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
    if (countError) {
      showMessage('Error checking user count: ' + countError.message, true)
      return
    }

    const confirmed = confirm(
      `Push "${q.text}" to the top of every user's feed and notify ${userCount ?? 0} user${userCount === 1 ? '' : 's'}? This can't be easily undone once sent.`
    )
    if (!confirmed) return

    try {
      // Previously fetched every profile id to the client (capped at 1000
      // by PostgREST's default row limit — once the user base passed that,
      // this was silently notifying only a subset with no error or
      // indication to the admin) and built/inserted the notification rows
      // from there. broadcast_breaking_news does the update + insert
      // entirely server-side via INSERT ... SELECT, so there's no
      // client-side row cap to hit no matter how large the user base gets.
      const { data, error } = await supabase
        .rpc('broadcast_breaking_news', { p_question_id: q.id })
        .single()
      if (error) throw error

      showMessage(`Pushed to top of feed and notified ${data?.notified_count ?? 0} users!`)
      loadQuestions()
    } catch (err) {
      showMessage('Error pushing question: ' + err.message, true)
    }
  }

  async function deleteQuestion(question) {
    if (!window.confirm(`Delete "${question.text.substring(0, 50)}..."? This cannot be undone.`)) return
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', question.id)
    if (!error) {
      showMessage('Question deleted.')
      loadQuestions()
      // Logged after the delete — target_id will point at a now-gone row,
      // which is expected for an audit trail entry; the question text is
      // captured in details since it wouldn't otherwise be recoverable.
      supabase.rpc('log_admin_action', {
        p_action_type: 'delete_question',
        p_target_type: 'question',
        p_target_id: question.id,
        p_details: { question_text: question.text },
      }).then(({ error }) => { if (error) console.error('log_admin_action failed', error) })
    } else {
      showMessage('Error deleting: ' + error.message, true)
    }
  }

  async function addArticle() {
    if (!selectedQuestionId) return showMessage('Select a question first.', true)
    if (!newArticle.url.trim() || !newArticle.outlet_name.trim()) return showMessage('URL and outlet name are required.', true)
    // This is UX only, not the real enforcement — the DB has its own
    // CHECK constraint (migration 059) rejecting anything but http(s).
    // Without this, a non-http(s) url (javascript:, data:, etc.) would
    // render as a real link to every reader on Make Up My Mind.
    if (!/^https?:\/\//i.test(newArticle.url.trim())) {
      return showMessage('Article URL must start with http:// or https://', true)
    }
    const { error } = await supabase.from('question_articles').insert({
      ...newArticle,
      question_id: selectedQuestionId,
    })
    if (error) {
      showMessage('Error adding article: ' + error.message, true)
    } else {
      showMessage('Article added!')
      setNewArticle({ url: '', title: '', outlet_name: '', stance: 'neutral', display_order: 1, human_curated: true, ai_excluded: false })
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Merriweather, serif', color: '#6B7280' }}>
        <LoadingSpinner />
      </div>
    )
  }

  if (!isAdmin) return null

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box' }}>

      <div style={{ marginBottom: '0.75rem' }}>
        <button
          onClick={() => navigate('/vote')}
          style={{ fontSize: '13px', color: '#2D3DCA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Merriweather, serif', padding: 0 }}
        >
          ← back
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '20px', fontWeight: 400, color: '#1A1A1A' }}>
          sense<span style={{ fontWeight: 700, color: '#6da627' }}>US</span>
          <span style={{ fontSize: '13px', color: '#6B7280', marginLeft: '8px' }}>Admin</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: registrationOpen ? '#eef3e0' : '#f9d8d8', border: `1px solid ${registrationOpen ? '#4d621d' : '#7a1313'}`, borderRadius: '10px', padding: '10px 16px', marginBottom: '1.5rem' }}>
        <span style={{ fontSize: '13px', fontWeight: 500, color: registrationOpen ? '#4d621d' : '#7a1313' }}>
          Registration is currently {registrationOpen ? 'OPEN' : 'CLOSED'}
        </span>
        <button
          onClick={() => toggleRegistration(!registrationOpen)}
          style={{ padding: '6px 16px', background: registrationOpen ? '#c21f1f' : '#4d621d', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
        >
          {registrationOpen ? 'Close registration' : 'Open registration'}
        </button>
      </div>

      {message && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', fontSize: '13px', background: message.isError ? '#f9d8d8' : '#eef3e0', color: message.isError ? '#7a1313' : '#4d621d' }}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '1.5rem', background: '#F3F4F6', padding: '4px', borderRadius: '10px' }}>
        <Tab label="Questions" active={tab === 'questions'} onClick={() => setTab('questions')} />
        <Tab label="Add Question" active={tab === 'add'} onClick={() => setTab('add')} />
        <Tab label="Add Article" active={tab === 'articles'} onClick={() => setTab('articles')} />
        <Tab label="Transparency" active={tab === 'transparency'} onClick={() => setTab('transparency')} />
        <Tab label="Review Queue" active={tab === 'review'} onClick={() => setTab('review')} />
        <Tab label="Flagged Comments" active={tab === 'comments'} onClick={() => setTab('comments')} />
        <Tab label="Broadcast" active={tab === 'broadcast'} onClick={() => setTab('broadcast')} />
        <Tab label="Reports" active={tab === 'reports'} onClick={() => setTab('reports')} badge={unresolvedCount} />
        <Tab label="Sponsored" active={tab === 'sponsored'} onClick={() => setTab('sponsored')} />
      </div>

      {/* Questions list */}
      {tab === 'questions' && (
        <div>
          <input
            type="text"
            value={questionSearchQuery}
            onChange={(e) => setQuestionSearchQuery(e.target.value)}
            placeholder="Search by text, category, or domain (e.g. &quot;hot take&quot;)..."
            style={{ display: 'block', width: '100%', marginBottom: '10px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px 12px', fontSize: '13px', fontFamily: 'Merriweather, serif', boxSizing: 'border-box' }}
          />
          <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '1rem' }}>
            {questionSearchQuery.trim()
              ? (searchingQuestions ? 'Searching...' : `${questionSearchResults.length} result${questionSearchResults.length === 1 ? '' : 's'} for "${questionSearchQuery.trim()}" (searches all questions, including drafts and archived)`)
              : `${questions.length} questions total (most recent 500 — use search above to find older, draft, or archived questions)`}
          </p>
          {loadingData ? (
            <div style={{ padding: '1rem 0' }}><LoadingSpinner size={18} label={null} /></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(questionSearchQuery.trim() ? questionSearchResults : questions).map(q => (
                <div key={q.id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px' }}>
                  {editingQuestion?.id === q.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <textarea
                        value={editingQuestion.text}
                        onChange={(e) => setEditingQuestion(p => ({ ...p, text: e.target.value }))}
                        rows={3}
                        style={{ width: '100%', border: '1px solid #2D3DCA', borderRadius: '8px', padding: '8px', fontSize: '13px', fontFamily: 'Merriweather, serif', boxSizing: 'border-box', resize: 'vertical' }}
                      />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <select
                          value={editingQuestion.category}
                          onChange={(e) => setEditingQuestion(p => ({ ...p, category: e.target.value }))}
                          style={{ border: '1px solid #D1D5DB', borderRadius: '6px', padding: '6px', fontSize: '12px', fontFamily: 'Merriweather, serif' }}
                        >
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select
                          value={editingQuestion.domain}
                          onChange={(e) => setEditingQuestion(p => ({ ...p, domain: e.target.value }))}
                          style={{ border: '1px solid #D1D5DB', borderRadius: '6px', padding: '6px', fontSize: '12px', fontFamily: 'Merriweather, serif' }}
                        >
                          {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={async () => {
                            const { error } = await supabase
                              .from('questions')
                              .update({
                                text: editingQuestion.text,
                                category: editingQuestion.category,
                                domain: editingQuestion.domain,
                              })
                              .eq('id', q.id)
                            if (!error) {
                              showMessage('Question updated!')
                              setEditingQuestion(null)
                              loadQuestions()
                            } else {
                              showMessage('Error: ' + error.message, true)
                            }
                          }}
                          style={{ flex: 1, padding: '7px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingQuestion(null)}
                          style={{ flex: 1, padding: '7px', background: '#F3F4F6', color: '#6B7280', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.4, marginBottom: '4px' }}>{q.text}</div>
                        <div style={{ fontSize: '11px', color: '#6B7280' }}>
                          #{q.question_number} · {q.category} · {q.domain}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button
                          onClick={() => setEditingQuestion({ ...q })}
                          style={{ padding: '5px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500, fontFamily: 'Merriweather, serif', background: '#E6F1FB', color: '#0C447C' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => pushAsBreakingNews(q)}
                          style={{ padding: '5px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500, fontFamily: 'Merriweather, serif', background: q.is_priority ? '#f9d8d8' : '#F3F4F6', color: q.is_priority ? '#7a1313' : '#6B7280' }}
                          title="Push to top of feed + notify everyone"
                        >
                          📢
                          </button>
                        <button
                          onClick={() => togglePublish(q)}
                          style={{
                            padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500, fontFamily: 'Merriweather, serif',
                            background: q.published_at ? '#eef3e0' : '#F3F4F6',
                            color: q.published_at ? '#4d621d' : '#6B7280',
                          }}
                        >
                          {q.published_at ? 'Published' : 'Draft'}
                        </button>
                        <button
                          onClick={() => deleteQuestion(q)}
                          style={{ padding: '5px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500, fontFamily: 'Merriweather, serif', background: '#f9d8d8', color: '#7a1313' }}
                          title="Delete question"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add question */}
      {tab === 'add' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Question text
            <textarea
              value={newQuestion.text}
              onChange={(e) => setNewQuestion(p => ({ ...p, text: e.target.value }))}
              placeholder="Enter the question..."
              rows={3}
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif', resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700 }}>
              Category
              <select
                value={newQuestion.category}
                onChange={(e) => setNewQuestion(p => ({ ...p, category: e.target.value }))}
                style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              >
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '13px', fontWeight: 700 }}>
              Domain
              <select
                value={newQuestion.domain}
                onChange={(e) => setNewQuestion(p => ({ ...p, domain: e.target.value }))}
                style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              >
                {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700 }}>
              Geographic scope
              <select
                value={newQuestion.geo_scope}
                onChange={(e) => setNewQuestion(p => ({ ...p, geo_scope: e.target.value, country_code: e.target.value === 'global' ? '' : p.country_code }))}
                style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              >
                <option value="global">Global</option>
                <option value="country">Country-specific</option>
                <option value="regional">Regional</option>
                <option value="country_own">Country (own only)</option>
              </select>
            </label>

            {(newQuestion.geo_scope === 'country' || newQuestion.geo_scope === 'regional') && (
              <label style={{ fontSize: '13px', fontWeight: 700 }}>
                Target country
                <select
                  value={newQuestion.country_code}
                  onChange={(e) => setNewQuestion(p => ({ ...p, country_code: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
                >
                  <option value="">Select country...</option>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option>
                  <option value="AU">Australia</option>
                  <option value="DE">Germany</option>
                  <option value="FR">France</option>
                  <option value="JP">Japan</option>
                  <option value="BR">Brazil</option>
                  <option value="IN">India</option>
                  <option value="NG">Nigeria</option>
                  <option value="PH">Philippines</option>
                </select>
              </label>
            )}
          </div>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={newQuestion.human_moderation_required} onChange={(e) => setNewQuestion(p => ({ ...p, human_moderation_required: e.target.checked }))} />
              Human moderation
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={newQuestion.ai_question} onChange={(e) => setNewQuestion(p => ({ ...p, ai_question: e.target.checked }))} />
              AI topic
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={newQuestion.is_current_event} onChange={(e) => setNewQuestion(p => ({ ...p, is_current_event: e.target.checked }))} />
              Current event
            </label>
          </div>

          {newQuestion.is_current_event && (
            <label style={{ fontSize: '13px', fontWeight: 700 }}>
              Archive on
              <input
                type="date"
                value={newQuestion.archive_at}
                onChange={(e) => setNewQuestion(p => ({ ...p, archive_at: e.target.value }))}
                style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              />
            </label>
          )}

          <button
            onClick={addQuestion}
            style={{ width: '100%', padding: '11px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
          >
            Add question
          </button>
        </div>
      )}

      {/* Add article */}
      {tab === 'articles' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Question
            <select
              value={selectedQuestionId}
              onChange={(e) => setSelectedQuestionId(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
            >
              <option value="">Select a question...</option>
              {questions.map(q => (
                <option key={q.id} value={q.id}>{q.text.substring(0, 60)}{q.text.length > 60 ? '...' : ''}</option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Article URL
            <input
              type="url"
              value={newArticle.url}
              onChange={(e) => setNewArticle(p => ({ ...p, url: e.target.value }))}
              placeholder="https://..."
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
            />
          </label>

          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Article title
            <input
              type="text"
              value={newArticle.title}
              onChange={(e) => setNewArticle(p => ({ ...p, title: e.target.value }))}
              placeholder="Article headline..."
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700 }}>
              Outlet name
              <input
                type="text"
                value={newArticle.outlet_name}
                onChange={(e) => setNewArticle(p => ({ ...p, outlet_name: e.target.value }))}
                placeholder="PBS, Reuters..."
                style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
              />
            </label>
            <label style={{ fontSize: '13px', fontWeight: 700 }}>
              Stance
              <select
                value={newArticle.stance}
                onChange={(e) => setNewArticle(p => ({ ...p, stance: e.target.value }))}
                style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              >
                {STANCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={newArticle.human_curated} onChange={(e) => setNewArticle(p => ({ ...p, human_curated: e.target.checked }))} />
              Human curated
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={newArticle.ai_excluded} onChange={(e) => setNewArticle(p => ({ ...p, ai_excluded: e.target.checked }))} />
              AI excluded
            </label>
          </div>

          <button
            onClick={addArticle}
            style={{ width: '100%', padding: '11px', background: '#52B788', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
          >
            Add article
          </button>
        </div>
      )}

      {/* Transparency events */}
      {tab === 'transparency' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Event type
            <select
              value={newEvent.event_type}
              onChange={(e) => setNewEvent(p => ({ ...p, event_type: e.target.value }))}
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
            >
              <option value="government_request">Government Request</option>
              <option value="security_incident">Security Incident</option>
            </select>
          </label>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Date occurred
            <input
              type="date"
              value={newEvent.occurred_at}
              onChange={(e) => setNewEvent(p => ({ ...p, occurred_at: e.target.value }))}
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
            />
          </label>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Description
            <textarea
              value={newEvent.description}
              onChange={(e) => setNewEvent(p => ({ ...p, description: e.target.value }))}
              placeholder="Describe the event..."
              rows={3}
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif', resize: 'vertical' }}
            />
          </label>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Resolution (optional)
            <textarea
              value={newEvent.resolution}
              onChange={(e) => setNewEvent(p => ({ ...p, resolution: e.target.value }))}
              placeholder="How was it resolved?"
              rows={2}
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif', resize: 'vertical' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={newEvent.is_public}
              onChange={(e) => setNewEvent(p => ({ ...p, is_public: e.target.checked }))}
            />
            Show publicly on transparency page
          </label>
          <button
            onClick={async () => {
              if (!newEvent.description.trim()) return showMessage('Description is required.', true)
              const { error } = await supabase.from('transparency_events').insert(newEvent)
              if (error) {
                showMessage('Error: ' + error.message, true)
              } else {
                showMessage('Event added to transparency report!')
                setNewEvent({ event_type: 'government_request', occurred_at: new Date().toISOString().split('T')[0], description: '', resolution: '', is_public: true })
              }
            }}
            style={{ width: '100%', padding: '11px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
          >
            Add to transparency report
          </button>
        </div>
      )}

      {/* Review queue */}
      {tab === 'review' && (
        <div>
          <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '1rem' }}>
            {flaggedQuestions.length} question{flaggedQuestions.length !== 1 ? 's' : ''} awaiting review
          </p>
          {loadingFlagged ? (
            <div style={{ padding: '1rem 0' }}><LoadingSpinner size={18} label={null} /></div>
          ) : flaggedQuestions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#6B7280', fontSize: '13px' }}>
              No questions pending review.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {flaggedQuestions.map(q => (
                <div key={q.id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.4, marginBottom: '8px' }}>{q.text}</div>
                  <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '10px' }}>
                    {q.category} · {q.domain}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={async () => {
                        const { error } = await supabase
                          .from('questions')
                          .update({ published_at: new Date().toISOString(), human_moderation_required: false })
                          .eq('id', q.id)
                        if (!error) {
                          showMessage('Question approved and published!')
                          loadFlaggedQuestions()
                          loadQuestions()
                        }
                      }}
                      style={{ flex: 1, padding: '7px', background: '#eef3e0', color: '#4d621d', border: '1px solid #4d621d', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                    >
                      Approve & publish
                    </button>
                    <button
                      onClick={async () => {
                        const { error } = await supabase
                          .from('questions')
                          .update({ published_at: null, human_moderation_required: true })
                          .eq('id', q.id)
                        if (!error) {
                          showMessage('Question kept in review queue.')
                        }
                      }}
                      style={{ flex: 1, padding: '7px', background: '#f9d8d8', color: '#7a1313', border: '1px solid #7a1313', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

{/* Flagged Comments */}
      {tab === 'comments' && (
        <div>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
            Flagged Comments ({flaggedComments.length})
          </p>
          {flaggedComments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: '#6B7280', fontSize: '13px' }}>
              No flagged comments.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {flaggedComments.map(comment => (
                <div key={comment.id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '4px' }}>
                    {/* is_flagged is set two ways: a user flagging the comment
                        (increments flag_count via increment_flag_count) or
                        moderate_comment()'s automatic keyword filter catching
                        a borderline word on post/edit (flag_count untouched,
                        stays 0). Both land in this same queue by design —
                        showing "0 flags" for the second case read like a
                        bug (a comment nobody flagged, sitting in "Flagged
                        Comments"), so it's called out explicitly instead. */}
                    On: {comment.questions?.text?.substring(0, 60)}...{' '}
                    {comment.flag_count > 0
                      ? `· ${comment.flag_count} flag${comment.flag_count !== 1 ? 's' : ''}`
                      : '· flagged for review (auto-detected, no user flags)'}
                  </div>
                  <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.4, marginBottom: '10px' }}>
                    {comment.body}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={async () => {
                        const { error } = await supabase
                          .from('comments')
                          .update({ is_deleted: true })
                          .eq('id', comment.id)
                        if (error) {
                          showMessage('Error removing comment: ' + error.message, true)
                          return
                        }
                        showMessage('Comment removed.')
                        loadFlaggedComments()
                        supabase.rpc('log_admin_action', {
                          p_action_type: 'remove_comment',
                          p_target_type: 'comment',
                          p_target_id: comment.id,
                          p_details: { comment_body: comment.body, flag_count: comment.flag_count },
                        }).then(({ error }) => { if (error) console.error('log_admin_action failed', error) })
                      }}
                      style={{ flex: 1, padding: '7px', background: '#f9d8d8', color: '#7a1313', border: '1px solid #7a1313', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                    >
                      Remove comment
                    </button>
                    <button
                      onClick={async () => {
                        const { error } = await supabase
                          .from('comments')
                          .update({ is_flagged: false, flag_count: 0 })
                          .eq('id', comment.id)
                        if (error) {
                          showMessage('Error clearing comment: ' + error.message, true)
                          return
                        }
                        showMessage('Comment cleared — no action taken.')
                        loadFlaggedComments()
                        supabase.rpc('log_admin_action', {
                          p_action_type: 'clear_comment_flag',
                          p_target_type: 'comment',
                          p_target_id: comment.id,
                          p_details: { comment_body: comment.body, flag_count: comment.flag_count },
                        }).then(({ error }) => { if (error) console.error('log_admin_action failed', error) })
                      }}
                      style={{ flex: 1, padding: '7px', background: '#eef3e0', color: '#4d621d', border: '1px solid #4d621d', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                    >
                      Clear flag
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reports */}
      {tab === 'reports' && <AdminReports supabase={supabase} />}

      {tab === 'sponsored' && (
        <div>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '14px', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A1A', marginBottom: '10px' }}>
              New sponsorship request
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <input
                type="number"
                placeholder="Question #"
                value={newSponsor.question_number}
                onChange={(e) => setNewSponsor(p => ({ ...p, question_number: e.target.value }))}
                style={{ border: '1px solid #D1D5DB', borderRadius: '6px', padding: '8px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              />
              <input
                type="text"
                placeholder="Sponsor name"
                value={newSponsor.sponsor_name}
                onChange={(e) => setNewSponsor(p => ({ ...p, sponsor_name: e.target.value }))}
                style={{ border: '1px solid #D1D5DB', borderRadius: '6px', padding: '8px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              />
              <input
                type="text"
                placeholder="Contact email (internal only)"
                value={newSponsor.sponsor_contact}
                onChange={(e) => setNewSponsor(p => ({ ...p, sponsor_contact: e.target.value }))}
                style={{ border: '1px solid #D1D5DB', borderRadius: '6px', padding: '8px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              />
              <select
                value={newSponsor.sponsor_category}
                onChange={(e) => setNewSponsor(p => ({ ...p, sponsor_category: e.target.value }))}
                style={{ border: '1px solid #D1D5DB', borderRadius: '6px', padding: '8px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              >
                <option value="brand">Brand</option>
                <option value="research">Research</option>
                <option value="ngo">NGO</option>
                <option value="media">Media</option>
                <option value="government">Government</option>
                <option value="political">Political</option>
                <option value="healthcare">Healthcare</option>
                <option value="technology">Technology</option>
                <option value="other">Other</option>
              </select>
              <input
                type="number"
                placeholder="Duration (days)"
                value={newSponsor.duration_days}
                onChange={(e) => setNewSponsor(p => ({ ...p, duration_days: e.target.value }))}
                style={{ border: '1px solid #D1D5DB', borderRadius: '6px', padding: '8px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              />
            </div>
            <button
              onClick={createSponsorship}
              style={{ padding: '8px 16px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
            >
              Add to queue
            </button>
          </div>

          <p style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A1A', marginBottom: '0.75rem' }}>
            Queue ({sponsoredQueue.length})
          </p>
          {sponsoredQueue.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: '#6B7280', fontSize: '13px' }}>
              No sponsorship requests yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {sponsoredQueue.map(row => {
                const statusLabels = {
                  eligible: { text: 'Ready to activate', color: '#4d621d', bg: '#eef3e0' },
                  in_cooldown: { text: 'Sponsor in cooldown', color: '#856404', bg: '#FFF3CD' },
                  slots_full: { text: 'Political slots full', color: '#7a1313', bg: '#f9d8d8' },
                  already_has_live_slot: { text: 'Sponsor already live', color: '#7a1313', bg: '#f9d8d8' },
                  live: { text: 'Live', color: '#4d621d', bg: '#eef3e0' },
                  archived: { text: 'Archived', color: '#6B7280', bg: '#F3F4F6' },
                  waitlisted: { text: 'Waitlisted', color: '#0C447C', bg: '#E6F1FB' },
                }
                const label = statusLabels[row.computed_eligibility] || statusLabels.waitlisted
                const canActivate = row.status === 'waitlisted' && (row.computed_eligibility === 'eligible' || row.domain !== 'politics & policy')

                return (
                  <div key={row.id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>{row.sponsor_name}</div>
                      <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: label.bg, color: label.color, fontWeight: 500 }}>
                        {label.text}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '4px' }}>{row.question_text}</div>
                    <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '10px' }}>
                      {row.domain} · {row.sponsor_category} · requested {new Date(row.created_at).toLocaleDateString()}
                    </div>

                    {row.status === 'rejected' ? (
                      <div style={{ fontSize: '12px', color: '#374151' }}>
                        <div style={{ marginBottom: '8px' }}>
                          {row.rejection_reason === 'rule_violation'
                            ? <><strong>Rejected — rule violation:</strong> {row.rejection_rule_detail}. Deposit forfeited{row.deposit_forfeited_at ? ` ${new Date(row.deposit_forfeited_at).toLocaleDateString()}` : ''}.</>
                            : <strong>Rejected — doesn't fit. Deposit is refundable.</strong>}
                        </div>
                        {row.rejection_reason === 'doesnt_fit' && (
                          <MilestonePill label="Deposit refunded" value={row.deposit_refunded_at} onClick={() => toggleMilestone(row, 'deposit_refunded_at')} />
                        )}
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                          <MilestonePill label="Deposit paid" value={row.deposit_paid_at} onClick={() => toggleMilestone(row, 'deposit_paid_at')} />
                          <MilestonePill label="Contract sent" value={row.contract_sent_at} onClick={() => toggleMilestone(row, 'contract_sent_at')} />
                          <MilestonePill label="Contract signed" value={row.contract_signed_at} onClick={() => toggleMilestone(row, 'contract_signed_at')} />
                          <MilestonePill label="Half balance paid" value={row.half_balance_paid_at} onClick={() => toggleMilestone(row, 'half_balance_paid_at')} />
                          <MilestonePill label="Results delivered" value={row.results_delivered_at} onClick={() => toggleMilestone(row, 'results_delivered_at')} />
                          <MilestonePill label="Final balance requested" value={row.final_balance_requested_at} onClick={() => toggleMilestone(row, 'final_balance_requested_at')} />
                          <MilestonePill label="Final balance paid" value={row.final_balance_paid_at} onClick={() => toggleMilestone(row, 'final_balance_paid_at')} />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {canActivate && (
                            <button
                              onClick={() => activateSponsorship(row.id)}
                              style={{ padding: '6px 14px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                            >
                              Activate
                            </button>
                          )}
                          {row.status === 'waitlisted' && (
                            <>
                              <button
                                onClick={() => rejectSponsorship(row.id, 'doesnt_fit')}
                                style={{ padding: '6px 14px', background: 'white', color: '#856404', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                              >
                                Reject — doesn't fit (refund)
                              </button>
                              <button
                                onClick={() => rejectSponsorship(row.id, 'rule_violation')}
                                style={{ padding: '6px 14px', background: 'white', color: '#7a1313', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                              >
                                Reject — rule violation (forfeit)
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <p style={{ fontSize: '12px', fontWeight: 700, color: '#1A1A1A', marginTop: '2rem', marginBottom: '0.75rem' }}>
            Pricing page inquiries ({sponsorshipInquiries.filter(i => i.status === 'new').length} new)
          </p>
          <p style={{ fontSize: '11px', color: '#6B7280', marginBottom: '0.75rem' }}>
            Submitted from the (unlinked) /sponsor pricing page. No deposit or card is collected at this stage — these are just "get in touch" leads for manual follow-up.
          </p>
          {sponsorshipInquiries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: '#6B7280', fontSize: '13px' }}>
              No inquiries yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {sponsorshipInquiries.map(inq => {
                const statusLabels = {
                  new: { text: 'New', color: '#0C447C', bg: '#E6F1FB' },
                  contacted: { text: 'Contacted', color: '#856404', bg: '#FFF3CD' },
                  archived: { text: 'Archived', color: '#6B7280', bg: '#F3F4F6' },
                }
                const label = statusLabels[inq.status] || statusLabels.new
                const scope = inq.tier === 'region' ? inq.region : inq.tier === 'country' ? inq.country_code : 'Global'
                return (
                  <div key={inq.id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A1A1A' }}>
                        {inq.name}{inq.company ? ` — ${inq.company}` : ''}
                      </div>
                      <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: label.bg, color: label.color, fontWeight: 500 }}>
                        {label.text}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '4px' }}>{inq.email}</div>
                    <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '10px' }}>
                      {inq.tier} · {scope} · {inq.category}{inq.wants_custom_content ? ' · custom content' : ''} · {new Date(inq.created_at).toLocaleDateString()}
                    </div>
                    {inq.message && (
                      <div style={{ fontSize: '12px', color: '#374151', marginBottom: '10px', fontStyle: 'italic' }}>"{inq.message}"</div>
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {inq.status !== 'contacted' && (
                        <button
                          onClick={() => updateInquiryStatus(inq.id, 'contacted')}
                          style={{ padding: '6px 14px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                        >
                          Mark contacted
                        </button>
                      )}
                      {inq.status !== 'archived' && (
                        <button
                          onClick={() => updateInquiryStatus(inq.id, 'archived')}
                          style={{ padding: '6px 14px', background: 'white', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Broadcast */}
      {tab === 'broadcast' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Title
            <input
              type="text"
              value={broadcast.title}
              onChange={(e) => setBroadcast(p => ({ ...p, title: e.target.value }))}
              placeholder="Notification title..."
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
            />
          </label>

          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Message
            <textarea
              value={broadcast.body}
              onChange={(e) => setBroadcast(p => ({ ...p, body: e.target.value }))}
              placeholder="Notification message..."
              rows={3}
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif', resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={{ fontSize: '13px', fontWeight: 700 }}>
              Priority
              <select
                value={broadcast.priority}
                onChange={(e) => setBroadcast(p => ({ ...p, priority: e.target.value }))}
                style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              >
                <option value="normal">Normal (silent)</option>
                <option value="high">High (popup on login)</option>
                <option value="urgent">Urgent (full screen)</option>
              </select>
            </label>
            <label style={{ fontSize: '13px', fontWeight: 700 }}>
              Audience
              <select
                value={broadcast.audience}
                onChange={(e) => setBroadcast(p => ({ ...p, audience: e.target.value }))}
                style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
              >
                <option value="all">All users</option>
                <option value="active">Active users (voted in last 30 days)</option>
                <option value="country">By country</option>
                <option value="age">By age range</option>
                <option value="country_age">By country + age range</option>
              </select>
            </label>

            {(broadcast.audience === 'country' || broadcast.audience === 'country_age') && (
              <label style={{ fontSize: '13px', fontWeight: 700 }}>
                Country code
                <select
                  value={broadcast.country_code}
                  onChange={(e) => setBroadcast(p => ({ ...p, country_code: e.target.value }))}
                  style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '9px', fontSize: '13px', fontFamily: 'Merriweather, serif' }}
                >
                  <option value="">Select country...</option>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option>
                  <option value="AU">Australia</option>
                  <option value="DE">Germany</option>
                  <option value="FR">France</option>
                  <option value="JP">Japan</option>
                  <option value="BR">Brazil</option>
                  <option value="IN">India</option>
                  <option value="MX">Mexico</option>
                  <option value="ZA">South Africa</option>
                  <option value="NG">Nigeria</option>
                  <option value="PH">Philippines</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
            )}

            {(broadcast.audience === 'age' || broadcast.audience === 'country_age') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ fontSize: '13px', fontWeight: 700 }}>
                  Min age
                  <input
                    type="number"
                    value={broadcast.age_min}
                    onChange={(e) => setBroadcast(p => ({ ...p, age_min: e.target.value }))}
                    placeholder="18"
                    min="18"
                    max="100"
                    style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
                  />
                </label>
                <label style={{ fontSize: '13px', fontWeight: 700 }}>
                  Max age
                  <input
                    type="number"
                    value={broadcast.age_max}
                    onChange={(e) => setBroadcast(p => ({ ...p, age_max: e.target.value }))}
                    placeholder="65"
                    min="18"
                    max="100"
                    style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
                  />
                </label>
              </div>
            )}
          </div>

          <label style={{ fontSize: '13px', fontWeight: 700 }}>
            Action URL (optional)
            <input
              type="text"
              value={broadcast.action_url}
              onChange={(e) => setBroadcast(p => ({ ...p, action_url: e.target.value }))}
              placeholder="/vote, /transparency, etc."
              style={{ display: 'block', width: '100%', marginTop: '6px', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '10px', fontSize: '14px', boxSizing: 'border-box', fontFamily: 'Merriweather, serif' }}
            />
          </label>

          <button
            onClick={async () => {
              if (!broadcast.title.trim() || !broadcast.body.trim()) return showMessage('Title and message are required.', true)
              setBroadcasting(true)

              // Both the recipient-count preview and the actual send run through
              // the same server-side RPC (p_dry_run toggles whether it inserts),
              // so the audience-filtering logic lives in exactly one place and
              // the preview number can never drift from what actually gets sent.
              // Previously this fetched every matching profile id — and, for the
              // "active users" audience, every votes row from the last 30 days —
              // to the client with no limit. PostgREST caps an unbounded select
              // at 1000 rows by default, so past that many users or votes this
              // would have silently notified only a subset, with no error and no
              // indication to the admin. Mirrors the fix already shipped for
              // "push as breaking news" (broadcast_breaking_news, migration 023)
              // — see broadcast_admin_notification, migration 040.
              const rpcParams = {
                p_title: broadcast.title,
                p_body: broadcast.body,
                p_priority: broadcast.priority,
                p_action_url: broadcast.action_url || null,
                p_audience: broadcast.audience,
                p_country_code: broadcast.country_code || null,
                p_age_min: broadcast.age_min ? parseInt(broadcast.age_min) : null,
                p_age_max: broadcast.age_max ? parseInt(broadcast.age_max) : null,
              }

              try {
                const { data: preview, error: previewError } = await supabase
                  .rpc('broadcast_admin_notification', { ...rpcParams, p_dry_run: true })
                  .single()
                if (previewError) throw previewError

                const previewCount = preview?.notified_count ?? 0
                if (previewCount === 0) {
                  showMessage('No users found.', true)
                  return
                }

                const confirmed = confirm(
                  `Send this broadcast to ${previewCount} user${previewCount === 1 ? '' : 's'}?`
                )
                if (!confirmed) return

                const { data, error } = await supabase
                  .rpc('broadcast_admin_notification', { ...rpcParams, p_dry_run: false })
                  .single()
                if (error) throw error

                showMessage(`Broadcast sent to ${data?.notified_count ?? 0} users!`)
                setBroadcast({ title: '', body: '', type: 'admin_broadcast', priority: 'normal', action_url: '', audience: 'all', country_code: '', age_min: '', age_max: '' })
              } catch (err) {
                showMessage('Error sending broadcast: ' + err.message, true)
              } finally {
                setBroadcasting(false)
              }
            }}
            disabled={broadcasting}
            style={{ width: '100%', padding: '11px', background: '#2D3DCA', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif', opacity: broadcasting ? 0.5 : 1 }}
          >
            {broadcasting ? 'Sending...' : 'Send broadcast'}
          </button>
        </div>
      )}

    </div>
  )
}
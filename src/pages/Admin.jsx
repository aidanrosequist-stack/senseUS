import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAdmin } from '../hooks/useAdmin'
import AdminReports from './AdminReports'
import { useAuth } from '../hooks/useAuth'

const CATEGORIES = ['fun', 'hot take', 'deep', 'topical', 'tracking', 'sponsored']
const DOMAINS = ['society & culture', 'ethics & philosophy', 'health & wellbeing', 'relationships', 'technology', 'money & work', 'media & information', 'politics & policy', 'science & nature', 'sports & leisure']
const STANCES = ['yes', 'ly', 'neutral', 'ln', 'no']

function Tab({ label, active, onClick }) {
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
      }}
    >
      {label}
    </button>
  )
}

export default function Admin() {
  const { isAdmin, loading } = useAdmin()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('questions')
  const [questions, setQuestions] = useState([])
  const [loadingData, setLoadingData] = useState(false)
  const [message, setMessage] = useState(null)
  const [flaggedComments, setFlaggedComments] = useState([])
  const [editingQuestion, setEditingQuestion] = useState(null)

  // New question form
  const [newQuestion, setNewQuestion] = useState({
    text: '',
    category: 'deep',
    domain: 'ethics & philosophy',
    geo_scope: 'global',
    is_tracking_anchor: false,
    human_moderation_required: false,
    ai_question: false,
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
    }
  }, [isAdmin])

  useEffect(() => {
    if (isAdmin) {
      loadQuestions()
      loadFlaggedQuestions()
      loadFlaggedComments()
    }
  }, [isAdmin])

  async function loadQuestions() {
    setLoadingData(true)
    const { data, error } = await supabase
      .from('questions')
      .select('id, text, category, domain, published_at, is_tracking_anchor')
      .order('created_at', { ascending: false })
    if (!error) setQuestions(data || [])
    setLoadingData(false)
  }

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
    const { error } = await supabase.from('questions').insert({
      ...newQuestion,
      published_at: new Date().toISOString(),
    })
    if (error) {
      showMessage('Error adding question: ' + error.message, true)
    } else {
      showMessage('Question added!')
      setNewQuestion({ text: '', category: 'deep', domain: 'ethics & philosophy', geo_scope: 'global', is_tracking_anchor: false, human_moderation_required: false, ai_question: false })
      loadQuestions()
    }
  }

  async function togglePublish(question) {
    const { error } = await supabase
      .from('questions')
      .update({ published_at: question.published_at ? null : new Date().toISOString() })
      .eq('id', question.id)
    if (!error) {
      showMessage(question.published_at ? 'Question unpublished.' : 'Question published!')
      loadQuestions()
    }
  }

  async function addArticle() {
    if (!selectedQuestionId) return showMessage('Select a question first.', true)
    if (!newArticle.url.trim() || !newArticle.outlet_name.trim()) return showMessage('URL and outlet name are required.', true)
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
        Loading...
      </div>
    )
  }

  if (!isAdmin) return null

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '1.5rem', fontFamily: 'Merriweather, serif', boxSizing: 'border-box' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '20px', fontWeight: 400, color: '#1A1A1A' }}>
          sense<span style={{ fontWeight: 700, color: '#2D3DCA' }}>US</span>
          <span style={{ fontSize: '13px', color: '#6B7280', marginLeft: '8px' }}>Admin</span>
        </div>
      </div>

      {message && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', fontSize: '13px', background: message.isError ? '#f9d8d8' : '#eef3e0', color: message.isError ? '#7a1313' : '#4d621d' }}>
          {message.text}
        </div>
      )}

{console.log('Current tab:', tab)}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '1.5rem', background: '#F3F4F6', padding: '4px', borderRadius: '10px' }}>
        <Tab label="Questions" active={tab === 'questions'} onClick={() => setTab('questions')} />
        <Tab label="Add Question" active={tab === 'add'} onClick={() => setTab('add')} />
        <Tab label="Add Article" active={tab === 'articles'} onClick={() => setTab('articles')} />
           <Tab label="Transparency" active={tab === 'transparency'} onClick={() => { console.log('Setting tab to transparency'); setTab('transparency') }} />
            <Tab label="Review Queue" active={tab === 'review'} onClick={() => setTab('review')} />
              <Tab label="Broadcast" active={tab === 'broadcast'} onClick={() => setTab('broadcast')} />
              <Tab label="Reports" active={tab === 'reports'} onClick={() => setTab('reports')} />
      </div>

      {/* Questions list */}
      {tab === 'questions' && (
        <div>
          <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '1rem' }}>{questions.length} questions total</p>
          {loadingData ? (
            <p style={{ color: '#6B7280', fontSize: '13px' }}>Loading...</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {questions.map(q => (
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
                          {q.is_tracking_anchor && ' · 📍 tracking'}
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
                          onClick={() => togglePublish(q)}
                          style={{
                            padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500, fontFamily: 'Merriweather, serif',
                            background: q.published_at ? '#eef3e0' : '#F3F4F6',
                            color: q.published_at ? '#4d621d' : '#6B7280',
                          }}
                        >
                          {q.published_at ? 'Published' : 'Draft'}
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

          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={newQuestion.is_tracking_anchor} onChange={(e) => setNewQuestion(p => ({ ...p, is_tracking_anchor: e.target.checked }))} />
              Tracking anchor
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={newQuestion.human_moderation_required} onChange={(e) => setNewQuestion(p => ({ ...p, human_moderation_required: e.target.checked }))} />
              Human moderation
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={newQuestion.ai_question} onChange={(e) => setNewQuestion(p => ({ ...p, ai_question: e.target.checked }))} />
              AI topic
            </label>
          </div>

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

{/* Transparency events */}
{tab === 'transparency' && console.log('rendering transparency tab')}
      {tab === 'transparency' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '200px', border: '1px solid red' }}>
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

{/* Review queue */}
      {tab === 'review' && (
        <div>
          <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '1rem' }}>
            {flaggedQuestions.length} question{flaggedQuestions.length !== 1 ? 's' : ''} awaiting review
          </p>
          {loadingFlagged ? (
            <p style={{ color: '#6B7280', fontSize: '13px' }}>Loading...</p>
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

          {/* Flagged comments */}
          <div style={{ marginTop: '2rem' }}>
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
                    <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '4px' }}>
                      On: {comment.questions?.text?.substring(0, 60)}... · {comment.flag_count} flag{comment.flag_count !== 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.4, marginBottom: '10px' }}>
                      {comment.body}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={async () => {
                          await supabase
                            .from('comments')
                            .update({ is_deleted: true })
                            .eq('id', comment.id)
                          showMessage('Comment removed.')
                          loadFlaggedComments()
                        }}
                        style={{ flex: 1, padding: '7px', background: '#f9d8d8', color: '#7a1313', border: '1px solid #7a1313', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                      >
                        Remove comment
                      </button>
                      <button
                        onClick={async () => {
                          await supabase
                            .from('comments')
                            .update({ is_flagged: false, flag_count: 0 })
                            .eq('id', comment.id)
                          showMessage('Comment cleared — no action taken.')
                          loadFlaggedComments()
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
        </div>
      )}

{/* Reports */}
{tab === 'reports' && <AdminReports supabase={supabase} />}

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

              try {
                // Get target users
                const currentYear = new Date().getFullYear()
                let query = supabase.from('profiles').select('id')

                if (broadcast.audience === 'active') {
                  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
                  const { data: activeUsers } = await supabase
                    .from('votes')
                    .select('user_id')
                    .gte('created_at', thirtyDaysAgo)
                  const activeIds = [...new Set((activeUsers || []).map(v => v.user_id))]
                  query = query.in('id', activeIds)
                }

                if ((broadcast.audience === 'country' || broadcast.audience === 'country_age') && broadcast.country_code) {
                  query = query.eq('country_code', broadcast.country_code)
                }

                if ((broadcast.audience === 'age' || broadcast.audience === 'country_age') && broadcast.age_min) {
                  const maxBirthYear = currentYear - parseInt(broadcast.age_min)
                  query = query.lte('birth_year', maxBirthYear)
                }

                if ((broadcast.audience === 'age' || broadcast.audience === 'country_age') && broadcast.age_max) {
                  const minBirthYear = currentYear - parseInt(broadcast.age_max)
                  query = query.gte('birth_year', minBirthYear)
                }

                const { data: users } = await query
                if (!users?.length) return showMessage('No users found.', true)

                // Insert notification for each user
                const notifications = users.map(u => ({
                  user_id: u.id,
                  type: 'admin_broadcast',
                  priority: broadcast.priority,
                  title: broadcast.title,
                  body: broadcast.body,
                  action_url: broadcast.action_url || null,
                }))

                const { error } = await supabase.from('notifications').insert(notifications)
                if (error) throw error

                showMessage(`Broadcast sent to ${users.length} users!`)
                setBroadcast({ title: '', body: '', type: 'admin_broadcast', priority: 'normal', action_url: '', audience: 'all' })
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
            <p style={{ color: '#6B7280', fontSize: '13px' }}>Loading...</p>
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

          {/* Flagged comments */}
          <div style={{ marginTop: '2rem' }}>
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
                    <div style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '4px' }}>
                      On: {comment.questions?.text?.substring(0, 60)}... · {comment.flag_count} flag{comment.flag_count !== 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.4, marginBottom: '10px' }}>
                      {comment.body}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={async () => {
                          await supabase
                            .from('comments')
                            .update({ is_deleted: true })
                            .eq('id', comment.id)
                          showMessage('Comment removed.')
                          loadFlaggedComments()
                        }}
                        style={{ flex: 1, padding: '7px', background: '#f9d8d8', color: '#7a1313', border: '1px solid #7a1313', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Merriweather, serif' }}
                      >
                        Remove comment
                      </button>
                      <button
                        onClick={async () => {
                          await supabase
                            .from('comments')
                            .update({ is_flagged: false, flag_count: 0 })
                            .eq('id', comment.id)
                          showMessage('Comment cleared — no action taken.')
                          loadFlaggedComments()
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
        </div>
      )}

    </div>
  )
}
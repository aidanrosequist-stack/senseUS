import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAdmin } from '../hooks/useAdmin'

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
  const navigate = useNavigate()
  const [tab, setTab] = useState('questions')
  const [questions, setQuestions] = useState([])
  const [loadingData, setLoadingData] = useState(false)
  const [message, setMessage] = useState(null)

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

  useEffect(() => {
    if (!loading && !isAdmin) {
      navigate('/')
    }
  }, [isAdmin, loading])

  useEffect(() => {
    if (isAdmin) loadQuestions()
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '1.5rem', background: '#F3F4F6', padding: '4px', borderRadius: '10px' }}>
        <Tab label="Questions" active={tab === 'questions'} onClick={() => setTab('questions')} />
        <Tab label="Add Question" active={tab === 'add'} onClick={() => setTab('add')} />
        <Tab label="Add Article" active={tab === 'articles'} onClick={() => setTab('articles')} />
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
                <div key={q.id} style={{ background: '#FFFFFF', border: '0.5px solid #E5E7EB', borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', color: '#1A1A1A', lineHeight: 1.4, marginBottom: '4px' }}>{q.text}</div>
                    <div style={{ fontSize: '11px', color: '#6B7280' }}>
                      {q.category} · {q.domain}
                      {q.is_tracking_anchor && ' · 📍 tracking'}
                    </div>
                  </div>
                  <button
                    onClick={() => togglePublish(q)}
                    style={{
                      padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 500, fontFamily: 'Merriweather, serif', flexShrink: 0,
                      background: q.published_at ? '#eef3e0' : '#F3F4F6',
                      color: q.published_at ? '#4d621d' : '#6B7280',
                    }}
                  >
                    {q.published_at ? 'Published' : 'Draft'}
                  </button>
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

    </div>
  )
}
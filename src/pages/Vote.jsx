import QuestionFlow from '../components/vote/QuestionFlow'

const SAMPLE_QUESTIONS = [
  {
    id: '1',
    category: 'deep',
    text: 'Is it possible to truly know another person?',
    votes: { yes: 203, ly: 441, ln: 188, no: 97 },
    replyCount: 312,
  },
  {
    id: '2',
    category: 'fun',
    text: 'Pineapple belongs on pizza.',
    votes: { yes: 412, ly: 198, ln: 143, no: 201 },
    replyCount: 87,
  },
  {
    id: '3',
    category: 'topical',
    text: 'Do you trust artificial intelligence?',
    votes: { yes: 188, ly: 302, ln: 255, no: 201 },
    replyCount: 154,
  },
]

export default function Vote() {
  return (
    <div
      style={{
        width: '100%',
        height: '100dvh',
        background: '#C7C7CC',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '14px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          height: '100%',
          maxHeight: '760px',
          borderRadius: '20px',
          overflow: 'hidden',
          border: '0.5px solid #E5E7EB',
          boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
          background: '#FFFFFF',
        }}
      >
        <QuestionFlow questions={SAMPLE_QUESTIONS} />
      </div>
    </div>
  )
}
import { useState } from 'react'
import { ArrowRight, Bot, Check, CircleAlert, LoaderCircle, RefreshCw, Send, Sparkles } from 'lucide-react'
import { readCoachQuestions } from './coachHistory'
import { keyId, type Person, type Session, type Skill } from './model'

type Challenge = { id: string; sourceQueryId: string; title: string; question: string; sourceQuery: string; skill: Skill }
type Evaluation = { score: number; xpEarned: number; creditsEarned: number; feedback: string; strength: string; nextStep: string; rewardClaimed: boolean }
type Props = { user: Person; onComplete: (session: Session) => void; onOpenCoach: () => void; notify: (message: string) => void }

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const challengeIdFor = (userId: string, questionId: string, date = new Date()) => `coach-challenge:${userId}:${questionId}:${dayKey(date)}`
const generatedKey = (userId: string) => `mindledger.challenges.generated.${userId}`
const readGeneratedQuestions = (userId: string): string[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(generatedKey(userId)) || '[]')
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string').slice(-40) : []
  } catch { return [] }
}
const rememberGeneratedQuestion = (userId: string, question: string) => {
  const previous = readGeneratedQuestions(userId)
  try { localStorage.setItem(generatedKey(userId), JSON.stringify([...previous, question].slice(-40))) } catch { /* History is a convenience; generation still works if storage is full. */ }
}

export default function ChallengePanel({ user, onComplete, onOpenCoach, notify }: Props) {
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const createChallenge = async () => {
    setLoading(true)
    setError('')
    setEvaluation(null)
    setAnswer('')
    try {
      const questions = readCoachQuestions(user.id).slice(0, 20)
      const previousChallenges = readGeneratedQuestions(user.id)
      if (!questions.length) {
        setError('There are no AI Coach questions on this profile yet. Ask the Coach something first, then come back to create a challenge.')
        return
      }
      const response = await fetch('/api/challenge-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachQuestions: questions, previousChallenges: previousChallenges.slice(-12) }),
        signal: AbortSignal.timeout(35_000),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not create a challenge from your Coach history. Please retry.')
      if (typeof data.id !== 'string' || typeof data.sourceQueryId !== 'string' || typeof data.title !== 'string' || typeof data.question !== 'string' || !data.question.trim()) {
        throw new Error('The AI returned an incomplete challenge. Please try again.')
      }
      if (previousChallenges.some(item => item.trim().toLocaleLowerCase() === data.question.trim().toLocaleLowerCase())) {
        throw new Error('The Coach repeated a recent challenge. Please generate again for a different question.')
      }
      rememberGeneratedQuestion(user.id, data.question)
      setChallenge({ id: data.id, sourceQueryId: data.sourceQueryId, title: data.title, question: data.question, sourceQuery: questions.find(q => q.id === data.sourceQueryId)?.text || '', skill: data.skill as Skill })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a challenge. Please retry.')
    } finally {
      setLoading(false)
    }
  }

  const submitAnswer = async () => {
    if (!challenge || !answer.trim() || loading || evaluation) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/challenge-evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: challenge.title, skill: challenge.skill, question: challenge.question, sourceQuery: challenge.sourceQuery, answer: answer.trim() }),
        signal: AbortSignal.timeout(35_000),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'AI scoring is unavailable. Your answer is still here; please retry.')
      if (!Number.isInteger(data.score) || data.score < 0 || data.score > 100 || !Number.isInteger(data.xpEarned) || data.xpEarned < 0 || data.xpEarned > 10 || typeof data.feedback !== 'string' || typeof data.strength !== 'string' || typeof data.nextStep !== 'string') {
        throw new Error('The AI returned an incomplete evaluation. Your answer is still here; please retry.')
      }
      const now = new Date()
      const challengeId = challengeIdFor(user.id, challenge.id, now)
      const rewardClaimed = user.sessions.some(s => s.challengeId === challengeId)
      const xpEarned = rewardClaimed ? 0 : data.xpEarned
      const creditsEarned = !rewardClaimed && data.score >= 70 ? 1 : 0
      const result = { score: data.score, xpEarned, creditsEarned, feedback: data.feedback, strength: data.strength, nextStep: data.nextStep, rewardClaimed }
      setEvaluation(result)
      onComplete({ id: keyId(), userId: user.id, type: 'mission', skill: challenge.skill, score: data.score, creditsEarned, xpEarned, date: now.toISOString(), durationMinutes: 2, title: challenge.title, response: answer.trim(), challengeId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI scoring is unavailable. Your answer is still here; please retry.')
    } finally {
      setLoading(false)
    }
  }

  const questions = readCoachQuestions(user.id)
  const hasHistory = questions.length > 0

  return <section className="challenges-page">
    <div className="section-head"><div><span className="eyebrow">AI COACH CHALLENGES</span><h2>Practice with questions from your chats.</h2><p className="section-sub">The Coach creates a fresh question inspired by one of your questions, then evaluates your answer and awards up to 10 XP.</p></div><button className="btn btn-primary" onClick={() => void createChallenge()} disabled={loading || !hasHistory}><Sparkles size={15}/>{loading && !evaluation ? 'Creating…' : challenge ? 'Generate another' : 'Create a challenge'}</button></div>

    {!hasHistory ? <div className="challenge-empty card"><span className="challenge-empty-icon"><Bot size={22}/></span><h3>Start with an AI Coach question</h3><p>Challenges are based on questions you’ve asked the AI Coach on this profile. Your chat history stays in this browser until you create one.</p><button className="btn btn-secondary" onClick={onOpenCoach}>Open AI Coach <ArrowRight size={15}/></button></div> : !challenge ? <div className="challenge-empty card"><span className="challenge-empty-icon"><Sparkles size={22}/></span><h3>Your Coach history is ready</h3><p>{questions.length} recent question{questions.length === 1 ? '' : 's'} available as inspiration. Generate one when you’re ready.</p></div> : <article className="history-challenge card">
      <div className="challenge-card-top"><span className="challenge-tag"><Sparkles size={13}/> FROM YOUR AI COACH</span></div>
      <h3>{challenge.title}</h3><p className="challenge-source"><span>Inspired by your chat</span>{challenge.sourceQuery}</p><p className="challenge-question">{challenge.question}</p>
      {!evaluation ? <><label className="challenge-answer"><span>Your answer</span><textarea rows={6} maxLength={4000} value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Explain your thinking…" disabled={loading}/></label><div className="challenge-eval-note"><Check size={14}/> AI evaluates how well your answer responds to the question. Stronger answers earn more XP, up to 10. A correct answer rated 70 or higher also earns 1 Think Credit.</div><div className="challenge-actions"><button className="btn btn-primary" onClick={() => void submitAnswer()} disabled={loading || !answer.trim()}>{loading ? <><LoaderCircle size={15} className="spin"/> Evaluating…</> : <><Send size={15}/> Submit answer</>}</button></div></> : <div className="challenge-result"><span className="check-bubble"><Check/></span><h4>AI rating · {evaluation.score}/100</h4><p className="challenge-strength">{evaluation.strength}</p><p>{evaluation.feedback}</p><p className="challenge-next-step">{evaluation.nextStep}</p><strong className="challenge-xp"><Sparkles size={15}/> +{evaluation.xpEarned} XP{evaluation.rewardClaimed && ' · daily reward already claimed'}</strong>{evaluation.creditsEarned>0&&<strong className="challenge-credit">+1 Think Credit</strong>}<button className="btn btn-secondary" onClick={() => { setChallenge(null); setEvaluation(null); setAnswer('') }}><RefreshCw size={14}/> New question</button></div>}
    </article>}
    {error && <div className="challenge-error" role="alert"><CircleAlert size={15}/><span>{error}</span>{!hasHistory&&<button className="text-action" onClick={onOpenCoach}>Open Coach</button>}</div>}
    <p className="challenge-privacy">Only your Coach questions are used to create a challenge. They and your answer are sent to Gemini for generation and scoring; supervisor dashboards do not receive them.</p>
  </section>
}

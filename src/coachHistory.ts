export type CoachQuestion = { id: string; text: string }

type StoredMessage = { id?: unknown; role?: unknown; text?: unknown }
type StoredConversation = { id?: unknown; updatedAt?: unknown; messages?: unknown }

const historyKeys = (userId: string) => [
  `mindledger.chats.${userId}.coach.think_first`,
  `mindledger.chats.${userId}.coach.instant_answer`,
  `mindledger.chats.${userId}.coach`,
  `mindledger.chats.${userId}.general`,
]

export function readCoachQuestions(userId: string): CoachQuestion[] {
  const conversations: StoredConversation[] = []
  for (const storageKey of historyKeys(userId)) {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
      if (Array.isArray(value)) conversations.push(...value as StoredConversation[])
    } catch {
      // Ignore malformed or old browser-local chat data.
    }
  }

  const seen = new Set<string>()
  const questions: CoachQuestion[] = []
  conversations
    .filter(c => c && Array.isArray(c.messages))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .forEach((conversation, conversationIndex) => {
      const messages = conversation.messages as StoredMessage[]
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i]
        if (message?.role !== 'user' || typeof message.text !== 'string') continue
        const text = message.text.trim().slice(0, 1500)
        if (!text) continue
        const id = typeof message.id === 'string' && message.id
          ? message.id
          : `${String(conversation.id || conversationIndex)}:${i}`
        if (seen.has(id)) continue
        seen.add(id)
        questions.push({ id, text })
        if (questions.length >= 20) return
      }
    })
  return questions.slice(0, 20)
}

import { createClient, type User } from '@supabase/supabase-js'
import type { Person } from '../model'

export type ProfileTransaction = { id: string; userId: string; amount: number; reason: string; sessionId?: string; at: string }
export type CloudProfile = { person: Person; transactions: ProfileTransaction[] }

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const supabase = projectUrl && publishableKey
  ? createClient(projectUrl, publishableKey, { auth: { persistSession: true, autoRefreshToken: true } })
  : null

export const hasCloudDatabase = Boolean(supabase)

export async function loadCloudProfile(authUser: User, fallback?: Partial<Person>): Promise<CloudProfile> {
  if (!supabase) throw new Error('Supabase is not configured for this app.')
  const { data, error } = await supabase
    .from('profile_documents')
    .select('profile, transactions')
    .eq('user_id', authUser.id)
    .maybeSingle()
  if (error) throw error

  const metadata = authUser.user_metadata?.profile_data as Partial<Person> | undefined
  const stored = data as { profile?: Partial<Person>; transactions?: ProfileTransaction[] } | null
  const source = stored?.profile ?? fallback ?? metadata
  if (!source) throw new Error('No profile is linked to this account yet. Contact the person who manages your MindLedger setup.')

  const person: Person = {
    ...source,
    id: authUser.id,
    email: authUser.email || source.email || '',
    password: '',
    sessions: Array.isArray(source.sessions) ? source.sessions : [],
    skills: source.skills || { Memory: { debt: 0, repaid: 0 }, Reasoning: { debt: 0, repaid: 0 }, Writing: { debt: 0, repaid: 0 }, Creativity: { debt: 0, repaid: 0 }, Focus: { debt: 0, repaid: 0 } },
    credits: typeof source.credits === 'number' ? source.credits : 100,
    createdAt: source.createdAt || authUser.created_at || new Date().toISOString(),
  } as Person
  const transactions = (Array.isArray(stored?.transactions) ? stored.transactions : Array.isArray(authUser.user_metadata?.profile_transactions) ? authUser.user_metadata.profile_transactions : [])
    .map(transaction => ({ ...transaction, userId: authUser.id }))
  if (!stored?.profile) await saveCloudProfile(person, transactions)
  return { person, transactions }
}

export async function saveCloudProfile(person: Person, transactions: ProfileTransaction[]) {
  if (!supabase) return
  const { password: _password, ...safeProfile } = person
  const { error } = await supabase.from('profile_documents').upsert({
    user_id: person.id,
    profile: safeProfile,
    transactions: transactions.filter(transaction => transaction.userId === person.id),
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

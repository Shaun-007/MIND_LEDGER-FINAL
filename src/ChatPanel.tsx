import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { ArrowRight, Bot, Check, CircleAlert, LoaderCircle, MessageSquarePlus, Send, Sparkles, Trash2, UserRound } from 'lucide-react'
import { supabase } from './lib/supabase'
import type { Person, Skill } from './model'

type Action='message'|'think'|'hint'|'answer'|'explain'|'example'|'test'
type ResponseStyle='think_first'|'instant_answer'
type Message={id:string;role:'user'|'assistant';text:string;stage?:string;hintLevel?:number;suggestedActions?:string[]}
type Conversation={id:string;title:string;messages:Message[];stage:string;hintLevel:number;updatedAt:string}
type Usage={allowed?:boolean;base_queries:number;daily_cap:number;plan_max:number;used_queries:number;queries_left:number;credits:number;plan_id:string}
type ApiResult={code?:string;message:string;stage:string;hintLevel:number;requiresUserResponse:boolean;transferQuestion:string;suggestedActions:string[];usage?:Usage}
const makeId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`
const key=(u:string,style:ResponseStyle)=>`mindledger.chats.${u}.coach.${style}`
const skillKey=(u:string)=>`mindledger.aiSkillsToday.${u}`
const todayKey=()=>new Date().toLocaleDateString('en-CA')
const skillFromText=(text:string,fallback:Skill):Skill=>{
 const value=text.toLocaleLowerCase()
 if(/memory|memor|remember|recall|flashcard|retention/.test(value))return'Memory'
 if(/reason|logic|math|equation|calculate|proof|solve|puzzle|code|algorithm/.test(value))return'Reasoning'
 if(/write|essay|draft|grammar|paragraph|email|summari[sz]e/.test(value))return'Writing'
 if(/creat|idea|brainstorm|design|story|invent|imagin/.test(value))return'Creativity'
 if(/focus|concentrat|attention|schedule|plan my|time manage|study plan/.test(value))return'Focus'
 return fallback
}
const mostOffloadedSkill=(user:Person):Skill=>{
 try{const stored=JSON.parse(localStorage.getItem(skillKey(user.id))||'{}') as {day?:string;counts?:Partial<Record<Skill,number>>};if(stored.day===todayKey()&&stored.counts){const top=Object.entries(stored.counts).sort((a,b)=>(b[1]||0)-(a[1]||0))[0];if(top&&(top[1]||0)>0)return top[0] as Skill}}catch{}
 return [...Object.entries(user.skills)].sort((a,b)=>b[1].debt-a[1].debt)[0]?.[0] as Skill||'Focus'
}
const emptyConversation=():Conversation=>({id:makeId(),title:'New conversation',messages:[],stage:'think_first',hintLevel:0,updatedAt:new Date().toISOString()})
function readConversations(userId:string,style:ResponseStyle):Conversation[]{
 const read=(storageKey:string):Conversation[]=>{try{const data=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(data)?data:[]}catch{return []}}
 const stored=read(key(userId,style));const legacy=style==='think_first'?[...read(`mindledger.chats.${userId}.coach`),...read(`mindledger.chats.${userId}.general`)]:[];const merged=new Map([...legacy,...stored].map(c=>[c.id,c]));
 return [...merged.values()].sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt))
}

export default function ChatPanel({user,onNavigate,onPricing}:{user:Person;onNavigate:(section:string)=>void;onPricing:()=>void}){
 const userId=user.id
 const [responseStyle,setResponseStyle]=useState<ResponseStyle>('think_first'),[thinkChats,setThinkChats]=useState(()=>readConversations(userId,'think_first')),[instantChats,setInstantChats]=useState(()=>readConversations(userId,'instant_answer')),[activeIds,setActiveIds]=useState<Record<ResponseStyle,string>>({think_first:'',instant_answer:''}),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[apiConfigured,setApiConfigured]=useState<boolean|null>(null)
 const [utcDay,setUtcDay]=useState(()=>new Date().toISOString().slice(0,10))
 const usageKey=`mindledger.aiUsage.${userId}.${utcDay}`
 const [dailyUsed,setDailyUsed]=useState(()=>Number(localStorage.getItem(usageKey)||0)),[creditBalance,setCreditBalance]=useState(user.credits),[serverUsage,setServerUsage]=useState<Usage|null>(null)
 const usedQueries=serverUsage?.used_queries??dailyUsed
 const queriesLeft=serverUsage?.queries_left??Math.floor(creditBalance/5)
 const allowance=serverUsage?.daily_cap??dailyUsed+Math.floor(creditBalance/5)
 const chats=responseStyle==='think_first'?thinkChats:instantChats;const activeId=activeIds[responseStyle]
 const messagesViewport=useRef<HTMLDivElement>(null);const active=chats.find(c=>c.id===activeId)||chats[chats.length-1]||null
 useEffect(()=>{const timer=window.setInterval(()=>{const day=new Date().toISOString().slice(0,10);setUtcDay(current=>current===day?current:day)},30_000);return()=>window.clearInterval(timer)},[])
 useEffect(()=>{setDailyUsed(Number(localStorage.getItem(usageKey)||0));setServerUsage(null);if(supabase&&!user.email.endsWith('@mindledger.demo'))void supabase.rpc('get_think_credit_status').then(({data,error})=>{if(error)return;const row=Array.isArray(data)?data[0]:data;if(typeof row?.credits==='number'){setCreditBalance(row.credits);window.dispatchEvent(new CustomEvent('mindledger:credit-balance',{detail:{userId,credits:row.credits}}))}});else{const today=utcDay,last=user.criticalModeLastActivated;const elapsed=last?Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(last+'T00:00:00Z'))/86400000):99;const grant=elapsed>=1&&elapsed<=4?80:100;if(user.creditDay!==today){setCreditBalance(grant);window.dispatchEvent(new CustomEvent('mindledger:credit-balance',{detail:{userId,credits:grant}}))}}},[usageKey])
 useEffect(()=>{if(!active&&chats.length===0){const fresh=emptyConversation();(responseStyle==='think_first'?setThinkChats:setInstantChats)([fresh]);setActiveIds(s=>({...s,[responseStyle]:fresh.id}))}else if(!active&&chats.length)setActiveIds(s=>({...s,[responseStyle]:chats[chats.length-1].id}))},[active,chats,responseStyle])
 useEffect(()=>{localStorage.setItem(key(userId,'think_first'),JSON.stringify(thinkChats))},[thinkChats,userId])
 useEffect(()=>{localStorage.setItem(key(userId,'instant_answer'),JSON.stringify(instantChats))},[instantChats,userId])
 useEffect(()=>{const el=messagesViewport.current;if(el)el.scrollTo({top:el.scrollHeight,behavior:'smooth'})},[active?.messages.length,busy])
 useEffect(()=>{let live=true;fetch('/api/health').then(r=>r.json()).then(d=>{if(live)setApiConfigured(Boolean(d.configured))}).catch(()=>{if(live)setApiConfigured(false)});return()=>{live=false}},[])
 useEffect(()=>{if(!supabase||user.email.endsWith('@mindledger.demo'))return;let live=true;void (async()=>{const {data}=await supabase.auth.getSession();if(!live||!data.session)return;const [status,usage]=await Promise.all([supabase.rpc('get_think_credit_status'),supabase.from('ai_daily_usage').select('used_queries').eq('user_id',userId).eq('usage_day',utcDay).maybeSingle()]);if(!live)return;const row=Array.isArray(status.data)?status.data[0]:status.data;if(typeof row?.credits==='number')setCreditBalance(row.credits);if(typeof usage.data?.used_queries==='number'){setDailyUsed(usage.data.used_queries);localStorage.setItem(usageKey,String(usage.data.used_queries))}})();return()=>{live=false}},[userId,usageKey])
 const updateActive=(change:(c:Conversation)=>Conversation)=>{if(!active)return;(responseStyle==='think_first'?setThinkChats:setInstantChats)(list=>list.map(c=>c.id===active.id?change(c):c))}
 const newChat=()=>{const fresh=emptyConversation();(responseStyle==='think_first'?setThinkChats:setInstantChats)(list=>[...list,fresh]);setActiveIds(s=>({...s,[responseStyle]:fresh.id}));setDraft('');setError('')}
 const clearHistory=()=>{if(!window.confirm('Delete all AI Coach chat history from this device, including both response modes?'))return;localStorage.removeItem(key(userId,'think_first'));localStorage.removeItem(key(userId,'instant_answer'));setThinkChats([]);setInstantChats([]);setActiveIds({think_first:'',instant_answer:''});setDraft('');setError('')}
 const send=async(action:Action='message',text=draft,retry=false)=>{
  if(busy||!active)return;const cleaned=text.trim();if(action==='message'&&!cleaned)return
  if(queriesLeft<=0){setError('You are out of credits for today. Complete a challenge to earn 10 more, or wait for your daily refill.');return}
  const userMessage:Message|undefined=action==='message'&&!retry?{id:makeId(),role:'user',text:cleaned}:undefined
  const nextMessages=userMessage?[...active.messages,userMessage]:active.messages
  const nextTitle=active.messages.length===0&&userMessage?cleaned.slice(0,38):active.title
  if(userMessage){updateActive(()=>({...active,messages:nextMessages,title:nextTitle,updatedAt:new Date().toISOString()}));setDraft('')}
  if(action==='message'&&!retry){const fallback=[...Object.entries(user.skills)].sort((a,b)=>b[1].debt-a[1].debt)[0]?.[0] as Skill||'Focus';const skill=skillFromText(cleaned,fallback);let record:{day:string;counts:Partial<Record<Skill,number>>}={day:todayKey(),counts:{}};try{const previous=JSON.parse(localStorage.getItem(skillKey(userId))||'{}');if(previous.day===record.day)record=previous}catch{}record.counts[skill]=(record.counts[skill]||0)+1;localStorage.setItem(skillKey(userId),JSON.stringify(record))}
  setBusy(true);setError('')
  try{
   const contextMessages=action==='message'?nextMessages.slice(0,-1):nextMessages
   const session=(await supabase?.auth.getSession())?.data.session
   const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.access_token}`}:{})},body:JSON.stringify({mode:'coach',responseStyle,action,message:cleaned,history:contextMessages.map(m=>({role:m.role,text:m.text})),stage:active.stage,hintLevel:active.hintLevel}),signal:AbortSignal.timeout(65_000)})
   let data:ApiResult&{message:string}
   try{data=await response.json() as ApiResult&{message:string}
   }catch{throw new Error('The Coach reply was interrupted before it finished. Your message is still here; please retry.')}
   if(!response.ok){if(user.email.endsWith('@mindledger.demo')&&data.code==='auth_required')throw new Error('Demo AI needs Supabase Anonymous Sign-Ins enabled. Ask the project admin to enable it and apply the credit migrations.');if(response.status===429&&data.usage){setServerUsage(data.usage);setDailyUsed(data.usage.used_queries);setCreditBalance(data.usage.credits);localStorage.setItem(usageKey,String(data.usage.used_queries));setError('');return}throw new Error(data.message||'MindLedger AI is temporarily unavailable. Your saved progress is safe. Please try again shortly.')}
   if(typeof data.message!=='string'||!data.message.trim())throw new Error('The AI response was empty. Your conversation is still here; please retry.')
   if(data.usage){const spent=Math.max(0,creditBalance-data.usage.credits);setServerUsage(data.usage);setDailyUsed(data.usage.used_queries);setCreditBalance(data.usage.credits);localStorage.setItem(usageKey,String(data.usage.used_queries));window.dispatchEvent(new CustomEvent('mindledger:credit-balance',{detail:{userId,credits:data.usage.credits,amountSpent:spent,eventId:spent?`ai-query-${userId}-${data.usage.used_queries}`:undefined}}))}else{const next=dailyUsed+1,balance=Math.max(0,creditBalance-5);setDailyUsed(next);setCreditBalance(balance);localStorage.setItem(usageKey,String(next));window.dispatchEvent(new CustomEvent('mindledger:credit-balance',{detail:{userId,credits:balance,amountSpent:5,eventId:`ai-query-${userId}-${next}`}}))}
   const assistant:Message={id:makeId(),role:'assistant',text:data.message,stage:data.stage,hintLevel:data.hintLevel,suggestedActions:data.suggestedActions}
   updateActive(c=>({...c,messages:[...c.messages,assistant],stage:data.stage,hintLevel:data.hintLevel,updatedAt:new Date().toISOString()}))
  }catch(e){setError(e instanceof Error?e.message:'MindLedger AI is temporarily unavailable. Your saved progress is safe. Please try again shortly.')}
  finally{setBusy(false)}
 }
 const submit=(e:FormEvent)=>{e.preventDefault();void send('message')};const keydown=(e:KeyboardEvent<HTMLTextAreaElement>)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send('message')}}
 const suggestions=['I’m learning the power rule. Can you help?','I’m stuck on this logic problem.','Help me plan a focused afternoon.','Explain recursion in Java.']
 const visibleActions=active?.messages.some(m=>m.role==='user')?(responseStyle==='think_first'?['Think First','Hint','Show Full Answer','Explain Differently','Give Me an Example','Test Me']:['Explain Differently','Give Me an Example','Test Me']):[]
 const actionMap:Record<string,Action>={'Think First':'think','Hint':'hint','Show Full Answer':'answer','Explain Differently':'explain','Give Me an Example':'example','Test Me':'test'}
 const history=useMemo(()=>[...chats].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,8),[chats])
 return <div className="chat-panel card">
  <div className="chat-top"><div><span className="eyebrow">YOUR AI COACH</span><h2>AI Coach</h2><p>{responseStyle==='think_first'?'Start with your own thinking. Get a hint or full answer when you choose.':'Get the complete answer and explanation right away.'}</p></div><div className="chat-top-tools"><div className="chat-response-switch" role="group" aria-label="Choose AI Coach response style"><button aria-pressed={responseStyle==='think_first'} className={responseStyle==='think_first'?'active':''} onClick={()=>{setError('');setResponseStyle('think_first')}}><Sparkles size={14}/> Think First</button><button aria-pressed={responseStyle==='instant_answer'} className={responseStyle==='instant_answer'?'active':''} onClick={()=>{setError('');setResponseStyle('instant_answer')}}>Instant Answer</button></div><button className="btn btn-secondary chat-new" onClick={newChat}><MessageSquarePlus size={15}/> New chat</button></div></div>
   <div className="chat-quota" aria-live="polite"><span>Queries left today: <b>{queriesLeft}</b> of {allowance}</span><span className="chat-credit-chip">Credits: {creditBalance}</span></div>
   {queriesLeft>0&&queriesLeft<=2&&<div className="chat-quota-banner"><span>You’re nearly out. Earn more by completing a challenge.</span><button className="btn btn-secondary" onClick={()=>{localStorage.setItem(`mindledger.targetSkill.${userId}`,mostOffloadedSkill(user));localStorage.setItem(`mindledger.resumeCoach.${userId}`,'yes');onNavigate('Challenges')}}>Earn more</button></div>}
   {queriesLeft===0&&<div className="chat-quota-empty"><strong>You are out of credits for today. Complete challenges to earn 10 credits (two responses), or wait for your daily refill.</strong><div><button className="btn btn-primary" onClick={()=>{localStorage.setItem(`mindledger.targetSkill.${userId}`,mostOffloadedSkill(user));localStorage.setItem(`mindledger.resumeCoach.${userId}`,'yes');onNavigate('Challenges')}}>Start a challenge</button><button className="btn btn-secondary" onClick={()=>onNavigate('Focus session')}>Focus session</button><button className="btn btn-secondary" onClick={()=>onNavigate('Wander break')}>Take a break</button></div></div>}
   <div className="chat-workspace"><aside className="chat-history"><span className="eyebrow">RECENT CHATS · {responseStyle==='think_first'?'THINK FIRST':'INSTANT ANSWER'}</span><button className="chat-clear-history" onClick={clearHistory}><Trash2 size={13}/> Clear chat history</button>{history.map(c=><button key={c.id} className={`chat-history-item ${active?.id===c.id?'active':''}`} onClick={()=>{setActiveIds(s=>({...s,[responseStyle]:c.id}));setError('')}}><span>{c.title}</span><small>{new Date(c.updatedAt).toLocaleDateString()}</small></button>)}{history.length===0&&<small className="quiet">Your conversations stay on this device.</small>}</aside>
   <div className="chat-thread"><div className="chat-mode-banner"><span className="chat-avatar"><Bot size={16}/></span><span><b>MindLedger AI Coach · {responseStyle==='think_first'?'Think First':'Instant Answer'}</b><small>{responseStyle==='think_first'?'A short thinking cue first; you control when to see the solution.':'A complete answer first, with follow-up help if you want it.'}</small></span><span className={`service-state ${apiConfigured?'online':'offline'}`}>{apiConfigured===null?'Checking…':apiConfigured?'Key configured':'Setup needed'}</span></div>
    <div className="chat-messages" ref={messagesViewport} aria-live="polite">{active?.messages.length===0&&<div className="chat-welcome"><span className="chat-welcome-icon"><Sparkles size={23}/></span><h3>{responseStyle==='think_first'?'What would you like to work through?':'What would you like answered?'}</h3><p>{responseStyle==='think_first'?'I’ll start with a small cue and give you room to think.':'I’ll give you the complete answer up front.'}</p><div className="suggested-prompts">{suggestions.map(x=><button key={x} onClick={()=>void send('message',x)}>{x}<ArrowRight size={13}/></button>)}</div></div>}
     {active?.messages.map(m=><div className={`chat-message ${m.role}`} key={m.id}><span className={`message-avatar ${m.role}`}>{m.role==='assistant'?<Bot size={14}/>:<UserRound size={14}/>}</span><div className="message-content"><div className="message-author">{m.role==='assistant'?'AI Coach':'You'}</div><div className="markdown-body"><ReactMarkdown>{m.text}</ReactMarkdown></div>{m.role==='assistant'&&m.stage&&<div className="stage-badge">{m.stage.replaceAll('_',' ')}{m.hintLevel?` · Hint ${m.hintLevel}`:''}</div>}</div></div>)}
     {busy&&<div className="chat-message assistant"><span className="message-avatar assistant"><Bot size={14}/></span><div className="message-content"><div className="message-author">AI Coach</div><div className="typing-indicator"><i/><i/><i/> Thinking</div></div></div>}{error&&<div className="chat-error" role="alert"><CircleAlert size={16}/><span>{error}</span><button className="btn btn-secondary" disabled={busy} onClick={()=>void send('message',active?.messages.filter(m=>m.role==='user').at(-1)?.text||draft,true)}>Retry</button></div>}</div>
    {visibleActions.length>0&&<div className="coach-actions" aria-label="AI Coach controls">{visibleActions.map(label=><button key={label} disabled={busy||(label==='Hint'&&(active?.hintLevel||0)>=3)} onClick={()=>void send(actionMap[label])}>{label==='Hint'&&(active?.hintLevel||0)>=3?'Hints complete':label}</button>)}</div>}
    <form className="chat-composer" onSubmit={submit}><textarea aria-label="Message MindLedger AI Coach" placeholder="Ask your AI Coach anything… (Shift+Enter for a new line)" rows={3} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={keydown} maxLength={4000} disabled={busy||queriesLeft===0}/><div className="composer-bottom"><span>Chat stays in this browser. Your message and recent context are sent to Google Gemini for a reply.{!apiConfigured&&apiConfigured!==null&&<b> Add GEMINI_API_KEY to enable.</b>}</span><button className="btn btn-primary" disabled={busy||!draft.trim()||queriesLeft===0} type="submit">{busy?<LoaderCircle size={15} className="spin"/>:<Send size={15}/>} Send</button></div></form>
   </div></div><p className="chat-safety"><Check size={13}/> One AI Coach is available to every profile. Think First and Instant Answer keep separate chat lists on this device. Chat history is not shown in supervisor dashboards; the local server does not save chat requests.</p>
 </div>
}

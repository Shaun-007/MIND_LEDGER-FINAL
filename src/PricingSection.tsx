import { useState } from 'react'
import { ArrowRight, Check, Coins, X } from 'lucide-react'
import { pricingPlans, type PricingSegment } from './plans'

export default function PricingSection({ onChoose }: { onChoose: (planId: string, segment: PricingSegment) => void }) {
  const [segment, setSegment] = useState<PricingSegment>('Home')
  const [annual, setAnnual] = useState(false)
  const [contact, setContact] = useState(false)
  const [sent, setSent] = useState(false)
  const plans = pricingPlans.filter(plan => plan.segment === segment)
  const openContact = () => { setSent(false); setContact(true) }
  const submitContact = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const subject = encodeURIComponent(`MindLedger ${segment} plan enquiry`)
    const body = encodeURIComponent(`Name: ${values.get('name')}\nEmail: ${values.get('email')}\nOrganisation: ${values.get('organisation')}\n\n${values.get('message')}`)
    window.location.href = `mailto:hello@mindledger.example?subject=${subject}&body=${body}`
    setSent(true)
  }
  const priceLabel = (plan: typeof plans[number]) => {
    if (plan.monthlyPrice === null) return 'Custom'
    if (plan.monthlyPrice === 0) return plan.id === 'school-pilot' ? 'Free' : 'Rs 0'
    return `Rs ${plan.monthlyPrice * (annual ? 10 : 1)}`
  }

  return <section className="pricing-section" id="pricing" aria-labelledby="pricing-title">
    <div className="pricing-heading"><span className="eyebrow">PLANS THAT GROW WITH YOU</span><h2 id="pricing-title">Pricing Plans</h2><p>Start free. Earn more AI by thinking.</p></div>
    <div className="pricing-controls">
      <div className="pricing-tabs" role="tablist" aria-label="Choose a space">
        {(['Home','School','Corporate'] as const).map(item=><button key={item} role="tab" aria-selected={segment===item} className={segment===item?'active':''} onClick={()=>setSegment(item)}>{item}</button>)}
      </div>
      <div className="billing-control"><span className={!annual?'selected':''}>Monthly</span><button type="button" className={`billing-toggle${annual?' active':''}`} role="switch" aria-checked={annual} aria-label="Annual billing" onClick={()=>setAnnual(value=>!value)}><i/></button><span className={annual?'selected':''}>Annual</span><b>2 months free</b></div>
    </div>
    <div className={`pricing-grid${plans.length===4?' four-plans':''}`}>
      {plans.map(plan=><article className={`pricing-card card${plan.popular?' popular':''}`} key={plan.id}>
        {plan.popular&&<span className="popular-badge">Most popular</span>}
        <span className="pricing-plan-name">{plan.name}</span>
        <div className="pricing-price"><strong>{priceLabel(plan)}</strong>{plan.monthlyPrice!==null&&plan.monthlyPrice>0&&<span>{plan.priceUnit.replace('/ month',annual?'/ year':'/ month')}</span>}{plan.monthlyPrice===0&&<span>{plan.priceUnit}</span>}</div>
        {annual&&plan.monthlyPrice!==null&&plan.monthlyPrice>0&&<small className="annual-note">Billed annually</small>}
        <p className="query-highlight">AI responses: 20 per day · 5 credits each</p>
        <ul>{plan.features.slice(0,5).map(feature=><li key={feature}><Check size={15}/>{feature}</li>)}</ul>
        <button className={`btn ${plan.popular?'btn-primary':'btn-secondary'} pricing-cta`} onClick={()=>plan.action==='Contact us'?openContact():onChoose(plan.id,segment)}>{plan.action}<ArrowRight size={15}/></button>
      </article>)}
    </div>
    <div className="credits-how card"><div><span className="credits-how-icon"><Coins size={17}/></span><strong>How credits work</strong></div><ol><li><i>1</i><span>Start with 100 daily credits for 20 AI responses</span></li><li><i>2</i><span>Earn 10 credits for a solved challenge <small>Up to five rewards in a rolling 24-hour period</small></span></li><li><i>3</i><span>Each response uses 5 credits <small>Challenge and Critical Mode credits extend your daily response allowance</small></span></li></ol></div>
    <div className="pricing-faq"><h3>Frequently asked questions</h3><details><summary>Is AI use unlimited?</summary><p>Daily credits set your allowance. Challenge rewards and Critical Mode can add credits for more responses.</p></details><details><summary>How do Think Credits work?</summary><p>Start with 100 credits daily; each AI response uses 5 credits, so the daily grant covers 20 responses. Each challenge reward adds 10 credits for two more responses.</p></details><details><summary>Can I change my plan later?</summary><p>You can choose a different plan from Pricing Plans. Plan activation is a demo flow; payments are not connected yet.</p></details><details><summary>What happens when I use my daily credits?</summary><p>Complete up to five challenges in a rolling 24-hour period for +10 credits each, or wait for your daily refill. Critical Mode adds 80 credits now and sets the daily refill to 80 for the next four days.</p></details></div>
    {contact&&<div className="pricing-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setContact(false)}}><section className="pricing-modal card" role="dialog" aria-modal="true" aria-labelledby="pricing-contact-title"><button className="icon-btn pricing-modal-close" onClick={()=>setContact(false)} aria-label="Close contact form"><X size={18}/></button><span className="eyebrow">INSTITUTIONAL ENQUIRY</span><h3 id="pricing-contact-title">Talk with our team</h3>{sent?<><p>Your email app should open with the enquiry details ready to send.</p><button className="btn btn-primary" onClick={()=>setContact(false)}>Done</button></>:<form className="pricing-contact-form" onSubmit={submitContact}><label>Name<input name="name" required autoComplete="name"/></label><label>Email<input name="email" type="email" required autoComplete="email"/></label><label>Organisation<input name="organisation" required/></label><label>Message<textarea name="message" required rows={3}/></label><button className="btn btn-primary" type="submit">Continue by email <ArrowRight size={15}/></button><small>Opens your email app; this form doesn’t send or store your details.</small></form>}</section></div>}
  </section>
}

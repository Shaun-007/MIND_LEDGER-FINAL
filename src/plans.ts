import type { Segment } from './model'

export type PricingSegment = 'Home' | 'School' | 'Corporate'
export type Plan = {
  id: string
  segment: PricingSegment
  name: string
  monthlyPrice: number | null
  priceUnit: string
  baseQueries: number
  dailyCap: number
  features: string[]
  popular?: boolean
  action: 'Start free' | 'Choose plan' | 'Start pilot' | 'Contact us'
}

export const pricingPlans: Plan[] = [
  { id:'home-free',segment:'Home',name:'Free',monthlyPrice:0,priceUnit:'',baseQueries:10,dailyCap:20,features:['1 child','Basic balance sheet','2 missions a day'],action:'Start free' },
  { id:'home-plus',segment:'Home',name:'Plus',monthlyPrice:199,priceUnit:'/ month',baseQueries:20,dailyCap:60,features:['1 child','All missions','Focus sessions','Progress charts','Recommendations'],popular:true,action:'Choose plan' },
  { id:'home-family',segment:'Home',name:'Family',monthlyPrice:349,priceUnit:'/ month',baseQueries:30,dailyCap:100,features:['Up to 4 children','Child switcher','Weekly parent report'],action:'Choose plan' },
  { id:'school-pilot',segment:'School',name:'Pilot',monthlyPrice:0,priceUnit:'for 30 days',baseQueries:10,dailyCap:25,features:['1 class','Up to 30 students','Class dashboard'],action:'Start pilot' },
  { id:'school-standard',segment:'School',name:'School',monthlyPrice:60,priceUnit:'/ student / month',baseQueries:15,dailyCap:50,features:['Teacher and student dashboards','Class analytics','AI-use transparency view'],popular:true,action:'Choose plan' },
  { id:'school-plus',segment:'School',name:'School Plus',monthlyPrice:100,priceUnit:'/ student / month',baseQueries:20,dailyCap:80,features:['Everything in School','LMS integration','Custom missions','Exportable reports'],action:'Choose plan' },
  { id:'school-institution',segment:'School',name:'Institution',monthlyPrice:null,priceUnit:'',baseQueries:20,dailyCap:100,features:['Multiple campuses','Admin controls','Guided onboarding'],action:'Contact us' },
  { id:'corporate-team',segment:'Corporate',name:'Team',monthlyPrice:199,priceUnit:'/ worker / month',baseQueries:20,dailyCap:80,features:['5 to 50 workers','HR dashboard','Worker dashboards','Team attention and recall trends'],popular:true,action:'Choose plan' },
  { id:'corporate-business',segment:'Corporate',name:'Business',monthlyPrice:349,priceUnit:'/ worker / month',baseQueries:30,dailyCap:120,features:['50+ workers','Burnout and recovery analytics','Skill-risk alerts','Exports'],action:'Choose plan' },
  { id:'corporate-enterprise',segment:'Corporate',name:'Enterprise',monthlyPrice:null,priceUnit:'',baseQueries:30,dailyCap:120,features:['Single sign-on','API access','Dedicated support'],action:'Contact us' },
]

for (const plan of pricingPlans) { plan.baseQueries = 20; plan.dailyCap = 20 }

export const getPlan = (id?: string) => pricingPlans.find(plan => plan.id === id) ?? pricingPlans[0]
export const segmentForPlan = (id?: string): Segment => getPlan(id).segment

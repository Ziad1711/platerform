import { createClient } from '@/lib/supabase/client'

export type Plan = {
  id: string
  name: string
  order_limit: number
  ai_credits_monthly: number
  stores_limit: number
  delivery_integrations_limit: number
  confirmation_agents_limit: number
  ads_automation_enabled: boolean
  api_access_enabled: boolean
  price: number
}

export async function getPlans(): Promise<Plan[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('price', { ascending: true })

  if (error) {
    console.error('Error fetching plans:', error)
    return []
  }

  return data ?? []
}

import { createBrowserClient } from '@supabase/ssr'
import { assertQualificationIsolation } from '@/lib/env/qualification-guard'

let client: ReturnType<typeof createBrowserClient> | null = null

export const createClient = () => {
  assertQualificationIsolation()
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }
  return client
}

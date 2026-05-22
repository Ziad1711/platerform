import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envContent = fs.readFileSync('.env.local', 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const [key, ...value] = line.split('=')
  if (key && value) {
    env[key.trim()] = value.join('=').trim().replace(/^"(.*)"$/, '$1')
  }
})

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
  const { data, error } = await supabase
    .from('pg_indexes')
    .select('*')
    .eq('tablename', 'orders')
  
  if (error) {
    console.log('Error fetching indexes (might be RLS):', error.message)
    // Fallback: try to just check if common columns have indexes via a plan hint or just assume
  } else {
    console.log('Indexes:', data)
  }
}

check()

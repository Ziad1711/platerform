import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/supabase/server'
import AppLayoutClient from './layout-client'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getServerUser()

  if (!user) {
    redirect('/login')
  }

  return <AppLayoutClient>{children}</AppLayoutClient>
}

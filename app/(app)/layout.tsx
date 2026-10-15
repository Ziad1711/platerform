import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/supabase/server'
import { AppProviders } from '@/components/providers'
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

  return (
    <AppProviders>
      <AppLayoutClient>{children}</AppLayoutClient>
    </AppProviders>
  )
}

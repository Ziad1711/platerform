'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { adminSections } from '@/lib/admin/navigation'
import { JisraMark, JisraWordmark } from '@/components/logo'

export function AdminShell({ children, permissions }: { children: React.ReactNode; permissions?: string[] }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  return <div className="min-h-screen bg-jisra-ink text-jisra-cream">
    <header className="flex min-h-20 items-center justify-between gap-4 border-b border-white/10 px-4 sm:px-8">
      <Link href="/admin" className="flex items-center gap-3"><JisraMark size={34} /><JisraWordmark size={28} /><span className="hidden text-xs uppercase tracking-widest text-jisra-green sm:inline">Administration</span></Link>
      <div className="flex items-center gap-4"><Link href="/" className="min-h-11 content-center text-sm underline">Site public</Link>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="admin-navigation" aria-label={open ? 'Fermer la navigation' : 'Ouvrir la navigation'} className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 lg:hidden">{open ? <X /> : <Menu />}</button></div>
    </header>
    <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav id="admin-navigation" aria-label="Administration Jisra" className={`${open ? 'block' : 'hidden'} border-b border-white/10 p-4 lg:block lg:min-h-[calc(100vh-80px)] lg:border-b-0 lg:border-r`}>
        <p className="mb-5 flex items-center gap-2 px-3 text-xs text-jisra-green"><ShieldCheck size={16} /> Espace plateforme indépendant</p>
        {adminSections.filter(section => !('permission' in section) || permissions?.includes(section.permission)).map((section) => {
          const href = `/admin${section.slug ? `/${section.slug}` : ''}`
          return <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined} onClick={() => setOpen(false)}
            className={`mb-1 flex min-h-11 items-center rounded-xl px-3 text-sm focus-visible:outline focus-visible:outline-jisra-green ${pathname === href ? 'bg-jisra-green/15 text-jisra-green-light' : 'text-jisra-cream/75 hover:bg-white/5'}`}>{section.title}</Link>
        })}
      </nav>
      <main className="min-w-0 p-4 sm:p-8 lg:p-10"><div className="mx-auto max-w-6xl">{children}</div></main>
    </div>
  </div>
}
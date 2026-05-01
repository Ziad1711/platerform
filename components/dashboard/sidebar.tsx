'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  Warehouse,
  Truck,
  Settings,
  MessageSquare,
  TrendingUp,
  DollarSign,
  Share2,
  Menu,
  X,
  ChevronLeft,
  LogOut,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { JisraMark, JisraWordmark } from '@/components/logo'

const menuItems = [
  { name: 'Tableau de bord', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Ventes', href: '/sales', icon: ShoppingCart },
  { name: 'Produits', href: '/products', icon: Package },
  { name: 'Stock', href: '/stock', icon: Warehouse },
  { name: 'Fournisseurs', href: '/suppliers', icon: Truck },
  { name: 'Publicité', href: '/advertising', icon: TrendingUp },
  { name: 'Dépenses', href: '/expenses', icon: DollarSign },
  { name: 'Intégration', href: '/integrations', icon: Share2 },
  { name: 'Livraison', href: '/delivery', icon: Truck },
  { name: 'Assistant IA', href: '/ai-assistant', icon: MessageSquare },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    setNavigatingTo(null)
    setMobileOpen(false)
  }, [pathname])

  // Close mobile sidebar on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setMobileOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const { data: userContext } = useQuery({
    queryKey: ['sidebar-user-context'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw error
      return data.user || null
    },
  })

  const { data: profile } = useQuery({
    queryKey: ['sidebar-profile', userContext?.id],
    enabled: !!userContext?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('first_name, last_name, full_name, avatar_url')
        .eq('id', userContext!.id)
        .maybeSingle()

      if (error) throw error
      return data || null
    },
  })

  const { data: currentSubscription } = useQuery({
    queryKey: ['sidebar-current-subscription', userContext?.id],
    enabled: !!userContext?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('status, plans(name)')
        .eq('user_id', userContext!.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throw error
      return data
    },
  })

  const displayName =
    profile?.full_name ||
    `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() ||
    'Utilisateur'

  const displayEmail = userContext?.email || '-'
  const displayPlan = (currentSubscription as any)?.plans?.name || 'Aucun plan'
  const avatarLetter = (displayName || 'U').charAt(0).toUpperCase()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const handleNavigation = (href: string) => {
    if (href === pathname) return
    setNavigatingTo(href)
    router.push(href)
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-border/10">
        <div className="flex items-center justify-between">
          {!collapsed && (
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <JisraMark size={28} ink="currentColor" accent="#1fa971" />
              <JisraWordmark size={20} ink="currentColor" accent="#1fa971" />
            </Link>
          )}
          {collapsed && (
            <Link href="/dashboard" className="mx-auto">
              <JisraMark size={28} ink="currentColor" accent="#1fa971" />
            </Link>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex p-1.5 rounded-lg hover:bg-foreground/5 text-muted-foreground/40 hover:text-muted-foreground/80 transition-all"
          >
            <ChevronLeft className={`w-4 h-4 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <ul className="space-y-1">
          {menuItems.map((item, index) => {
            const Icon = item.icon
            const isActive = pathname === item.href || navigatingTo === item.href

            return (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => handleNavigation(item.href)}
                  className={`flex items-center w-full rounded-lg transition-all duration-200 group ${
                    collapsed ? 'justify-center p-3' : 'px-3 py-2.5'
                  } ${
                    isActive
                      ? 'bg-primary text-white shadow-lg shadow-primary/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                  }`}
                >
                  <Icon className={`${collapsed ? 'w-5 h-5' : 'w-5 h-5 shrink-0'}`} />
                  {!collapsed && (
                    <span className="ml-3 flex items-center gap-2 text-sm font-medium">
                      <span>{item.name}</span>
                      {navigatingTo === item.href && (
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      )}
                    </span>
                  )}
                  {collapsed && (
                    <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 shadow-lg border border-border/10">
                      {item.name}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User & Logout */}
      <div className="px-3 py-4 border-t border-border/10">
        {!collapsed && (
          <div className="flex items-center justify-between mb-3 px-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                {profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover rounded-full" />
                ) : (
                  <span className="text-xs font-semibold text-primary">{avatarLetter}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{displayName}</div>
                <div className="text-xs text-muted-foreground truncate">{displayEmail}</div>
              </div>
            </div>
            <Link
              href="/settings"
              className="p-1.5 rounded-lg hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-all"
            >
              <Settings className="w-4 h-4" />
            </Link>
          </div>
        )}

        {collapsed && (
          <div className="flex flex-col items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <span className="text-xs font-semibold text-primary">{avatarLetter}</span>
            </div>
            <Link
              href="/settings"
              className="p-1.5 rounded-lg hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-all"
            >
              <Settings className="w-4 h-4" />
            </Link>
          </div>
        )}

        {!collapsed && (
          <div className="px-2 mb-3">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-primary/10 border border-primary/20">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-xs text-muted-foreground font-mono">{displayPlan}</span>
            </div>
          </div>
        )}

        <button
          onClick={handleLogout}
          className={`flex items-center w-full rounded-lg transition-all duration-200 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 ${
            collapsed ? 'justify-center p-3' : 'px-3 py-2.5'
          }`}
        >
          <LogOut className="w-5 h-5" />
          {!collapsed && <span className="ml-3 text-sm">Déconnexion</span>}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-background border border-border shadow-lg text-foreground hover:bg-secondary transition-all"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar (Drawer) - always shows names */}
      <div
        className={`lg:hidden fixed inset-y-0 left-0 z-40 w-72 bg-background border-r border-border shadow-2xl transform transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="px-5 py-6 border-b border-border">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <JisraMark size={28} ink="currentColor" accent="#1fa971" />
              <JisraWordmark size={20} ink="currentColor" accent="#1fa971" />
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 overflow-y-auto text-foreground">
            <ul className="space-y-1">
              {menuItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || navigatingTo === item.href
                return (
                  <li key={item.name}>
                    <button
                      type="button"
                      onClick={() => handleNavigation(item.href)}
                      className={`flex items-center w-full rounded-lg transition-all duration-200 px-3 py-2.5 ${
                        isActive
                          ? 'bg-primary text-white shadow-lg shadow-primary/20'
                          : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                      }`}
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span className="ml-3 flex items-center gap-2 text-sm font-medium">
                        <span>{item.name}</span>
                        {navigatingTo === item.href && (
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* User & Logout */}
          <div className="px-3 py-4 border-t border-border">
            <div className="flex items-center justify-between mb-3 px-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover rounded-full" />
                  ) : (
                    <span className="text-xs font-semibold text-primary">{avatarLetter}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{displayName}</div>
                  <div className="text-xs text-muted-foreground truncate">{displayEmail}</div>
                </div>
              </div>
              <Link
                href="/settings"
                className="p-1.5 rounded-lg hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-all"
              >
                <Settings className="w-4 h-4" />
              </Link>
            </div>
            <div className="px-2 mb-3">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-primary/10 border border-primary/20">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-xs text-muted-foreground font-mono">{displayPlan}</span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center w-full rounded-lg transition-all duration-200 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 px-3 py-2.5"
            >
              <LogOut className="w-5 h-5" />
              <span className="ml-3 text-sm">Déconnexion</span>
            </button>
          </div>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div
        className={`hidden lg:flex h-screen bg-background border-r border-border flex-col transition-all duration-300 ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {sidebarContent}
      </div>
    </>
  )
}

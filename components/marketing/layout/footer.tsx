import Link from 'next/link'
import { Container } from '@/components/marketing/shared/container'
import { JisraMark, JisraWordmark } from '@/components/logo'
import { AnimatedButton } from '@/components/marketing/shared/animated-button'

const columns = [
  {
    title: 'Produit',
    links: [
      { href: '/features', label: 'Fonctionnalités' },
      { href: '/pricing', label: 'Tarifs' },
      { href: '/features#integrations', label: 'Intégrations' },
      { href: '/login?signup=1', label: 'Démarrer' },
    ],
  },
  {
    title: 'Entreprise',
    links: [
      { href: '/about', label: 'À propos' },
      { href: '/contact', label: 'Contact' },
      { href: '/login', label: 'Connexion' },
      { href: '/contact', label: 'Démo' },
    ],
  },
  {
    title: 'Ressources',
    links: [
      { href: '/features/assistant-ia', label: 'Assistant IA' },
      { href: '/features/publicite', label: 'Publicité & ROI' },
      { href: '/features/livraison', label: 'Livraison' },
      { href: '/features/multi-stores', label: 'Multi-stores' },
    ],
  },
  {
    title: 'Légal',
    links: [
      { href: '/legal/conditions', label: 'Conditions' },
      { href: '/legal/confidentialite', label: 'Confidentialité' },
      { href: '/legal/mentions', label: 'Mentions légales' },
    ],
  },
]

export function MarketingFooter() {
  return (
    <footer className="relative border-t border-white/10 bg-[#0f1512] text-jisra-cream">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-jisra-green/60 to-transparent" />
      <Container className="py-16 sm:py-20">
        <div className="marketing-panel marketing-noise overflow-hidden px-6 py-8 sm:px-8 sm:py-10 lg:px-10">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_repeat(4,0.72fr)]">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
                  <JisraMark size={30} ink="#f3efe6" accent="#1fa971" />
                </div>
                <div>
                  <JisraWordmark size={20} ink="#f3efe6" accent="#1fa971" />
                  <p className="mt-1 text-[10px] uppercase tracking-[0.28em] text-jisra-cream/42">Moroccan commerce OS</p>
                </div>
              </div>

              <p className="max-w-md text-sm leading-7 text-jisra-cream/64">
                jisra unifie commandes, publicité, livraison, stock et profit net pour offrir aux e-commerçants marocains une exécution plus rapide et une lecture plus juste du business.
              </p>

              <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-jisra-green-light">Newsletter</p>
                <p className="mt-2 text-sm leading-6 text-jisra-cream/58">
                  Reçus produit, nouveautés intégrations et conseils rentabilité. Sans bruit.
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <div className="flex min-h-11 flex-1 items-center rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-jisra-cream/42">
                    email@business.ma
                  </div>
                  <AnimatedButton href="/contact" className="sm:px-4">
                    S’inscrire
                  </AnimatedButton>
                </div>
              </div>
            </div>

            {columns.map((column) => (
              <div key={column.title} className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-jisra-cream/82">
                  {column.title}
                </h3>
                <ul className="space-y-3 text-sm text-jisra-cream/56">
                  {column.links.map((link) => (
                    <li key={`${column.title}-${link.href}-${link.label}`}>
                      <Link href={link.href} className="transition-colors duration-300 hover:text-jisra-cream">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-6 text-xs text-jisra-cream/42 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p>© {new Date().getFullYear()} Jisra. Tous droits réservés.</p>
              <span className="hidden h-1 w-1 rounded-full bg-jisra-cream/30 lg:inline-flex" />
              <p>Conçu pour les e-commerçants marocains · Français d’abord</p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <span>Langue : FR</span>
              <Link href="/contact" className="transition-colors hover:text-jisra-cream">
                LinkedIn
              </Link>
              <Link href="/contact" className="transition-colors hover:text-jisra-cream">
                WhatsApp
              </Link>
              <Link href="/contact" className="transition-colors hover:text-jisra-cream">
                Contact sales
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </footer>
  )
}
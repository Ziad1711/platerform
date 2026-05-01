'use client'

import { useTheme } from '@/components/providers'
import { Sun, Moon } from 'lucide-react'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <button
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      className="p-2 rounded-xl bg-jisra-green/10 border border-jisra-green/20 text-jisra-green hover:bg-jisra-green/20 hover:text-jisra-green-light transition-all duration-200"
      title={theme === 'light' ? 'Basculer en mode sombre' : 'Basculer en mode clair'}
    >
      {theme === 'light' ? (
        <Moon className="w-4 h-4" />
      ) : (
        <Sun className="w-4 h-4" />
      )}
    </button>
  )
}

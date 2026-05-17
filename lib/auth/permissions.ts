export type Role =
  | 'owner'
  | 'admin'
  | 'confirmation'
  | 'delivery'
  | 'stock_manager'
  | 'accountant'
  | 'marketer'
  | 'viewer'

export type Permission =
  | 'dashboard.view'
  | 'sales.view'
  | 'sales.update_status'
  | 'sales.write'
  | 'sales.delete'
  | 'products.view'
  | 'products.manage'
  | 'stock.view'
  | 'stock.manage'
  | 'suppliers.view'
  | 'suppliers.manage'
  | 'advertising.view'
  | 'advertising.manage'
  | 'expenses.view'
  | 'expenses.manage'
  | 'delivery.view'
  | 'delivery.manage'
  | 'integrations.view'
  | 'integrations.manage'
  | 'ai_assistant.use'
  | 'settings.profile'
  | 'settings.preferences'
  | 'settings.exchange_rates'
  | 'settings.blacklist'
  | 'team.view'
  | 'team.invite'
  | 'team.change_role'
  | 'team.remove'
  | 'stores.create'
  | 'stores.update'
  | 'stores.delete'
  | 'billing.manage'

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    'dashboard.view',
    'sales.view','sales.update_status','sales.write','sales.delete',
    'products.view','products.manage',
    'stock.view','stock.manage',
    'suppliers.view','suppliers.manage',
    'advertising.view','advertising.manage',
    'expenses.view','expenses.manage',
    'delivery.view','delivery.manage',
    'integrations.view','integrations.manage',
    'ai_assistant.use',
    'settings.profile','settings.preferences','settings.exchange_rates','settings.blacklist',
    'team.view','team.invite','team.change_role','team.remove',
    'stores.create','stores.update','stores.delete',
    'billing.manage',
  ],
  admin: [
    'dashboard.view',
    'sales.view','sales.update_status','sales.write','sales.delete',
    'products.view','products.manage',
    'stock.view','stock.manage',
    'suppliers.view','suppliers.manage',
    'advertising.view','advertising.manage',
    'expenses.view','expenses.manage',
    'delivery.view','delivery.manage',
    'integrations.view','integrations.manage',
    'ai_assistant.use',
    'settings.profile','settings.preferences','settings.exchange_rates','settings.blacklist',
    'team.view','team.invite','team.change_role','team.remove',
    'stores.create','stores.update',
  ],
  confirmation: [
    'sales.view','sales.update_status',
  ],
  delivery: [
    'sales.view',
    'delivery.view','delivery.manage',
  ],
  stock_manager: [
    'products.view','products.manage',
    'stock.view','stock.manage',
    'suppliers.view','suppliers.manage',
  ],
  accountant: [
    'dashboard.view',
    'sales.view',
    'expenses.view','expenses.manage',
  ],
  marketer: [
    'dashboard.view',
    'advertising.view','advertising.manage',
    'integrations.view','integrations.manage',
  ],
  viewer: [
    'dashboard.view',
    'sales.view',
    'products.view',
    'stock.view',
    'suppliers.view',
    'advertising.view',
    'expenses.view',
    'delivery.view',
    'integrations.view',
    'ai_assistant.use',
  ],
}

export function hasPermission(role: Role | null, permission: Permission): boolean {
  if (!role) return false
  const perms = ROLE_PERMISSIONS[role]
  if (!perms) return false
  return perms.includes(permission)
}

export const MENU_PERMISSIONS: Record<string, Permission[]> = {
  '/dashboard': ['dashboard.view'],
  '/sales': ['sales.view'],
  '/products': ['products.view'],
  '/stock': ['stock.view'],
  '/suppliers': ['suppliers.view'],
  '/advertising': ['advertising.view'],
  '/expenses': ['expenses.view'],
  '/integrations': ['integrations.view'],
  '/delivery': ['delivery.view'],
  '/ai-assistant': ['ai_assistant.use'],
  '/settings': ['settings.profile'],
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Propriétaire',
  admin: 'Admin',
  confirmation: 'Confirmation',
  delivery: 'Livraison',
  stock_manager: 'Gestionnaire Stock',
  accountant: 'Comptable',
  marketer: 'Marketer',
  viewer: 'Lecture seule',
}

export const INVITABLE_ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: ROLE_LABELS.admin },
  { value: 'confirmation', label: ROLE_LABELS.confirmation },
  { value: 'delivery', label: ROLE_LABELS.delivery },
  { value: 'stock_manager', label: ROLE_LABELS.stock_manager },
  { value: 'accountant', label: ROLE_LABELS.accountant },
  { value: 'marketer', label: ROLE_LABELS.marketer },
  { value: 'viewer', label: ROLE_LABELS.viewer },
]

/**
 * Retourne la première page autorisée pour un rôle donné.
 * Utilisé pour rediriger l'utilisateur après connexion/acceptation d'invitation
 * vers la page la plus pertinente selon son rôle.
 */
export function getFirstAllowedRoute(role: Role | null): string {
  if (!role) return '/dashboard'
  const routeMap: Partial<Record<Role, string>> = {
    confirmation: '/sales',
    delivery: '/delivery',
    stock_manager: '/products',
  }
  return routeMap[role] ?? '/dashboard'
}

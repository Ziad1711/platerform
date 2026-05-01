# Tech Context

## Technology Stack

### Frontend Framework
- **Next.js 15.1.6**: React framework with App Router
- **React 19.0.0**: UI library
- **TypeScript 5.7.3**: Type safety and developer experience

### Styling & UI
- **Tailwind CSS 3.4.0**: Utility-first CSS framework
- **shadcn/ui**: Component library built on Radix UI
- **class-variance-authority**: Component variant management
- **tailwind-merge**: Utility class merging
- **tailwindcss-animate**: Animation utilities
- **Lucide React 0.468.0**: Icon library

### Backend & Database
- **Supabase**: 
  - PostgreSQL database
  - Authentication (Auth)
  - Row Level Security (RLS)
  - Storage (avatars bucket)
  - Real-time subscriptions (future)
- **@supabase/supabase-js 2.49.1**: JavaScript client
- **@supabase/ssr 0.9.0**: Server-side rendering support

### State Management & Data Fetching
- **@tanstack/react-query 5.62.9**: Server state management, caching, and synchronization

### Validation & Utilities
- **Zod 3.24.1**: Schema validation
- **date-fns 4.1.0**: Date manipulation
- **clsx 2.1.1**: Conditional class names

### Data Visualization
- **Recharts 2.15.0**: Chart library for analytics dashboard

## Development Setup

### Prerequisites
- Node.js (version compatible with Next.js 15)
- npm package manager
- Supabase account and project

### Environment Variables
Required in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Development Commands
```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

### Project Structure
```
platerform/
├── app/                    # Next.js App Router
│   ├── dashboard/         # Protected dashboard routes
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Landing page
│   └── globals.css        # Global styles
├── components/            # React components
│   ├── auth/             # Authentication components
│   ├── dashboard/        # Dashboard components
│   └── ui/               # shadcn/ui components
├── lib/                   # Utilities and configurations
│   ├── supabase/         # Supabase clients
│   └── utils.ts          # Helper functions
├── services/              # Business logic (planned)
├── hooks/                 # Custom React hooks (planned)
├── types/                 # TypeScript types (planned)
├── memory-bank/          # Project documentation
├── middleware.ts         # Next.js middleware (auth)
├── tailwind.config.ts    # Tailwind configuration
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies
```

## Technical Constraints

### Performance Requirements
- Dashboard load time: < 2 seconds
- Query optimization: Always filter by store_id
- Index strategy: (store_id, date) for time-series data
- Scalability threshold: 500k orders (switch to metrics table)

### Code Quality Standards
- **File Size**: Maximum 200-300 lines per file
- **Type Safety**: Strict TypeScript mode
- **Validation**: Zod schemas for all user inputs
- **Error Handling**: Try-catch blocks for async operations
- **Component Structure**: Separation of UI and business logic

### Security Requirements
- Row Level Security (RLS) on all Supabase tables
- Server-side authentication checks via middleware
- Secure session management with httpOnly cookies
- Input validation on both client and server
- No sensitive data in client-side code

### Browser Support
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile responsive (iOS Safari, Chrome Mobile)

## Dependencies Overview

### Core Dependencies
- **next**: React framework with SSR/SSG
- **react** & **react-dom**: UI library
- **typescript**: Type system

### Supabase Integration
- **@supabase/supabase-js**: Database and auth client
- **@supabase/ssr**: Server-side rendering helpers

### UI & Styling
- **tailwindcss**: CSS framework
- **shadcn/ui components**: Pre-built accessible components
- **lucide-react**: Icon system
- **recharts**: Data visualization

### Data Management
- **@tanstack/react-query**: Async state management
- **zod**: Runtime type validation
- **date-fns**: Date utilities

## Tool Usage Patterns

### Supabase Client Usage
```typescript
// Server Components (app/dashboard/page.tsx)
import { createServerClient } from '@/lib/supabase/server'

// Client Components (components/dashboard/...)
import { createBrowserClient } from '@/lib/supabase/client'
```

### React Query Pattern
```typescript
// Fetch data with caching
const { data, isLoading, error } = useQuery({
  queryKey: ['orders', storeId],
  queryFn: () => fetchOrders(storeId)
})

// Mutations with cache invalidation
const mutation = useMutation({
  mutationFn: createOrder,
  onSuccess: () => {
    queryClient.invalidateQueries(['orders'])
  }
})
```

### Form Validation Pattern
```typescript
// Define schema
const orderSchema = z.object({
  customer_name: z.string().min(1),
  phone: z.string().min(10),
  total: z.number().positive()
})

// Validate input
const result = orderSchema.safeParse(formData)
```

## Deployment

### Target Platform
- **Vercel**: Optimized for Next.js deployment
- Automatic deployments from Git
- Environment variables configured in Vercel dashboard
- Edge functions for middleware

### Build Configuration
- Output: Standalone (optimized for serverless)
- Image optimization: Enabled
- Static generation: Where applicable
- ISR: For frequently updated pages

## Future Technical Considerations

### Planned Integrations
- Delivery company APIs (tracking sync)
- Payment gateway (subscription billing)
- AI service backend (assistant chatbot)
- Email service (notifications)

### Scalability Plans
- Implement metrics table when approaching 500k orders
- Consider edge caching for dashboard KPIs
- Optimize database queries with materialized views
- Implement background jobs for heavy calculations

### Monitoring & Observability
- Error tracking (to be implemented)
- Performance monitoring (to be implemented)
- Database query performance tracking
- User analytics (to be implemented)

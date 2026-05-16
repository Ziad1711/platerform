const BUILD_ID =
  process.env.NEXT_PUBLIC_BUILD_ID ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  'dev'

/**
 * Cache-busting helper for static assets in `public/`.
 * Appends `?v=<build-id>` so browsers re-fetch after each deploy.
 */
export const v = (path: string): string =>
  path.includes('?') ? `${path}&v=${BUILD_ID}` : `${path}?v=${BUILD_ID}`

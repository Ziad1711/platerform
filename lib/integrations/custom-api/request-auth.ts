import { NextRequest, NextResponse } from 'next/server'
import { ApiScope, hasScope, validateApiKey } from './auth'

export type PublicApiContext = {
  storeId: string
  apiKeyId: string | null
  scopes: ApiScope[]
}

type PublicApiAuthResult =
  | { context: PublicApiContext; error: null }
  | { context: null; error: NextResponse }

/**
 * Authentifie une requête API publique via l'en-tête `Authorization: Bearer <clé>`
 * et vérifie que la clé possède le périmètre demandé.
 */
export async function requirePublicApiAuth(
  request: NextRequest,
  requiredScope: ApiScope
): Promise<PublicApiAuthResult> {
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      context: null,
      error: NextResponse.json(
        { error: 'Unauthorized', code: 'MISSING_AUTHORIZATION', message: 'En-tête Authorization Bearer requis' },
        { status: 401 }
      ),
    }
  }

  const apiKey = authHeader.slice(7).trim()
  const { valid, storeId, apiKeyId, scopes, reason } = await validateApiKey(apiKey)

  if (!valid || !storeId) {
    const status = reason === 'INVALID_FORMAT' ? 400 : 401
    return {
      context: null,
      error: NextResponse.json(
        { error: 'Unauthorized', code: reason, message: 'Clé API invalide ou révoquée' },
        { status }
      ),
    }
  }

  if (!hasScope(scopes, requiredScope)) {
    return {
      context: null,
      error: NextResponse.json(
        {
          error: 'Forbidden',
          code: 'MISSING_SCOPE',
          message: `Cette clé API ne possède pas le périmètre requis : ${requiredScope}`,
        },
        { status: 403 }
      ),
    }
  }

  return { context: { storeId, apiKeyId, scopes }, error: null }
}

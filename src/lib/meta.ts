const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaErrorResponse {
  error?: {
    message?: string
    code?: number
    type?: string
    error_subcode?: number
  }
}

function formatMetaError(response: Response, fallback: string) {
  return response
    .json()
    .then((data: MetaErrorResponse) => {
      return data.error?.message ?? fallback
    })
    .catch(() => fallback)
}

async function fetchGraph<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${META_API_BASE}/${path}`
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await formatMetaError(response, `Meta API error: ${response.status}`)
    throw new Error(message)
  }

  return response.json()
}

async function fetchRawGraph<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${META_API_BASE}/${path}`, init)
  if (!response.ok) {
    const message = await formatMetaError(response, `Meta API error: ${response.status}`)
    throw new Error(message)
  }
  return response.json()
}

export interface WhatsAppEmbeddedSignupAccount {
  businessId: string
  businessName?: string
  wabaId: string
  wabaName?: string
  phoneNumberId: string
  displayPhoneNumber?: string
}

export async function exchangeMetaAuthCodeForShortLivedAccessToken(
  code: string,
  redirectUri: string,
): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET

  if (!appId || !appSecret) {
    throw new Error('META_APP_SECRET or NEXT_PUBLIC_META_APP_ID is not set')
  }

  const url = new URL(`${META_API_BASE}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('code', code)

  const response = await fetch(url.toString())
  if (!response.ok) {
    const message = await formatMetaError(response, `Meta OAuth error: ${response.status}`)
    throw new Error(message)
  }

  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error('Meta OAuth did not return an access token')
  }
  return data.access_token
}

export async function exchangeShortLivedAccessTokenForLongLivedAccessToken(
  shortLivedToken: string,
): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID
  const appSecret = process.env.META_APP_SECRET

  if (!appId || !appSecret) {
    throw new Error('META_APP_SECRET or NEXT_PUBLIC_META_APP_ID is not set')
  }

  const url = new URL(`${META_API_BASE}/oauth/access_token`)
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('fb_exchange_token', shortLivedToken)

  const response = await fetch(url.toString())
  if (!response.ok) {
    const message = await formatMetaError(response, `Meta OAuth exchange error: ${response.status}`)
    throw new Error(message)
  }

  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error('Failed to obtain a long-lived Meta access token')
  }
  return data.access_token
}

interface GetMeResponse {
  id: string
  name?: string
  businesses?: {
    data?: Array<{
      id: string
      name?: string
      owned_whatsapp_business_accounts?: {
        data?: Array<{
          id: string
          name?: string
          phone_numbers?: { data?: Array<{ id: string; display_phone_number?: string }> }
        }>
      }
    }>
  }
}

interface PhoneNumberListResponse {
  data?: Array<{ id: string; display_phone_number?: string }>
}

export async function resolveWhatsAppBusinessAccountFromAccessToken(
  accessToken: string,
): Promise<WhatsAppEmbeddedSignupAccount> {
  const me = await fetchGraph<GetMeResponse>(
    'me?fields=id,name,businesses{owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number}}}',
    accessToken,
  )

  const businesses = me.businesses?.data ?? []
  for (const business of businesses) {
    const businessId = business.id
    const businessName = business.name
    const waAccounts = business.owned_whatsapp_business_accounts?.data ?? []

    for (const waba of waAccounts) {
      const phoneNumbers = waba.phone_numbers?.data ?? []
      if (phoneNumbers.length > 0) {
        return {
          businessId,
          businessName,
          wabaId: waba.id,
          wabaName: waba.name,
          phoneNumberId: phoneNumbers[0].id,
          displayPhoneNumber: phoneNumbers[0].display_phone_number,
        }
      }
    }
  }

  for (const business of businesses) {
    const businessId = business.id
    const businessName = business.name
    const waAccounts = business.owned_whatsapp_business_accounts?.data ?? []

    for (const waba of waAccounts) {
      const phoneList = await fetchGraph<PhoneNumberListResponse>(
        `${encodeURIComponent(waba.id)}/phone_numbers?fields=id,display_phone_number`,
        accessToken,
      )
      if (phoneList.data?.length) {
        return {
          businessId,
          businessName,
          wabaId: waba.id,
          wabaName: waba.name,
          phoneNumberId: phoneList.data[0].id,
          displayPhoneNumber: phoneList.data[0].display_phone_number,
        }
      }
    }
  }

  throw new Error(
    'No connected WhatsApp Business Account and phone number were found for the authenticated user.',
  )
}

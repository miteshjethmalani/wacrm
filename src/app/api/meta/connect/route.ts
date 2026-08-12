import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  exchangeMetaAuthCodeForShortLivedAccessToken,
  exchangeShortLivedAccessTokenForLongLivedAccessToken,
  resolveWhatsAppBusinessAccountFromAccessToken,
} from '@/lib/meta'
import { encrypt } from '@/lib/whatsapp/encryption'
import { subscribeWabaToApp, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const body = await request.json()
    const { code, accessToken: providedAccessToken, redirectUri } = body ?? {}

    if (!redirectUri || typeof redirectUri !== 'string') {
      return NextResponse.json(
        { error: 'redirectUri is required' },
        { status: 400 },
      )
    }

    if (!code && !providedAccessToken) {
      return NextResponse.json(
        { error: 'code or accessToken is required' },
        { status: 400 },
      )
    }

    const shortLivedToken = code
      ? await exchangeMetaAuthCodeForShortLivedAccessToken(code, redirectUri)
      : providedAccessToken

    const accessToken = await exchangeShortLivedAccessTokenForLongLivedAccessToken(
      shortLivedToken,
    )

    const details = await resolveWhatsAppBusinessAccountFromAccessToken(accessToken)
    const { phoneNumberId, wabaId, businessId } = details

    const { data: claimed, error: claimError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phoneNumberId)
      .neq('account_id', ctx.accountId)
      .maybeSingle()

    if (claimError) {
      console.error('Error checking phone_number_id ownership:', claimError)
      return NextResponse.json(
        { error: 'Failed to validate connected phone number' },
        { status: 500 },
      )
    }

    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already linked to another account on this instance.',
        },
        { status: 409 },
      )
    }

    const phoneInfo = await verifyPhoneNumber({
      phoneNumberId,
      accessToken,
    })

    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
    if (!verifyToken) {
      return NextResponse.json(
        {
          error:
            'Server is missing META_WEBHOOK_VERIFY_TOKEN. Configure this environment variable and retry.',
        },
        { status: 500 },
      )
    }

    let encryptedAccessToken: string
    let encryptedVerifyToken: string
    try {
      encryptedAccessToken = encrypt(accessToken)
      encryptedVerifyToken = encrypt(verifyToken)
    } catch (err) {
      console.error('Encryption failed:', err)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt sensitive data. Check that ENCRYPTION_KEY is configured correctly.',
        },
        { status: 500 },
      )
    }

    let subscribedAppsAt: string | null = null
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      console.warn('WABA subscribed_apps failed (non-fatal):', err)
    }

    const existing = await ctx.supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    const row = {
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      business_id: businessId,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: 'connected',
      connected_at: new Date().toISOString(),
      registered_at: null,
      subscribed_apps_at: subscribedAppsAt,
      last_registration_error: null,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await ctx.supabase
        .from('whatsapp_config')
        .update(row)
        .eq('account_id', ctx.accountId)

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json(
          { error: 'Failed to save WhatsApp configuration' },
          { status: 500 },
        )
      }
    } else {
      const { error: insertError } = await ctx.supabase
        .from('whatsapp_config')
        .insert({
          account_id: ctx.accountId,
          user_id: ctx.userId,
          ...row,
        })

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json(
          { error: 'Failed to save WhatsApp configuration' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({
      success: true,
      connected: true,
      phoneNumberId,
      wabaId,
      businessId,
      displayPhoneNumber: phoneInfo.display_phone_number,
      verifiedName: phoneInfo.verified_name,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

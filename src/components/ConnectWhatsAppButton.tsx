'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

const CONFIGURATION_ID =
  process.env.NEXT_PUBLIC_META_CONFIGURATION_ID ?? '1602329044956967'

interface ConnectWhatsAppButtonProps {
  connected?: boolean
  disabled?: boolean
  onSuccess?: (payload: {
    phoneNumberId: string
    wabaId: string
    businessId: string
    displayPhoneNumber?: string
    verifiedName?: string
  }) => void
}

interface FbLoginResponse {
  status: string
  authResponse?: {
    accessToken?: string
    userID?: string
    expiresIn?: number
    signedRequest?: string
    code?: string
    session_info?: { session_id?: string }
  }
}

declare global {
  interface Window {
    fbAsyncInit?: () => void
    FB?: {
      init: (opts: {
        appId: string
        cookie: boolean
        xfbml: boolean
        version: string
      }) => void
      login: (
        callback: (response: FbLoginResponse) => void,
        options?: Record<string, unknown>,
      ) => void
    }
  }
}

let fbSdkPromise: Promise<typeof window.FB> | null = null

function loadFacebookSdk(appId: string): Promise<typeof window.FB> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Facebook SDK can only load in the browser'))
  }

  if (window.FB) {
    window.FB.init({
      appId,
      cookie: true,
      xfbml: false,
      version: 'v16.0',
    })
    return Promise.resolve(window.FB)
  }

  if (fbSdkPromise) {
    return fbSdkPromise
  }

  fbSdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) {
        reject(new Error('Facebook SDK loaded but window.FB is unavailable'))
        return
      }
      window.FB.init({
        appId,
        cookie: true,
        xfbml: false,
        version: 'v16.0',
      })
      resolve(window.FB)
    }

    const scriptId = 'facebook-jssdk'
    if (document.getElementById(scriptId)) {
      // Script already injected, wait for FB to become available.
      const existing = document.getElementById(scriptId)
      if (existing && window.FB) {
        resolve(window.FB)
      }
      return
    }

    const root = document.getElementById('fb-root') ?? document.createElement('div')
    if (!document.getElementById('fb-root')) {
      root.id = 'fb-root'
      document.body.appendChild(root)
    }

    const script = document.createElement('script')
    script.id = scriptId
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Failed to load Facebook SDK'))
    document.body.appendChild(script)
  })

  return fbSdkPromise
}

export function ConnectWhatsAppButton({
  connected,
  disabled,
  onSuccess,
}: ConnectWhatsAppButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleConnect() {
    if (disabled) return
    if (!process.env.NEXT_PUBLIC_META_APP_ID) {
      toast.error('Meta App ID is not configured.')
      return
    }

    setLoading(true)
    try {
      const FB = await loadFacebookSdk(process.env.NEXT_PUBLIC_META_APP_ID)
      if (!FB) {
        throw new Error('Facebook SDK failed to initialize.')
      }

      const response = await new Promise<FbLoginResponse>((resolve) => {
        FB.login(resolve, {
          config_id: CONFIGURATION_ID,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            feature: 'whatsapp_embedded_signup',
            sessionInfoVersion: 3,
          },
        })
      })

      if (!response || response.status !== 'connected' || !response.authResponse) {
        toast.error('WhatsApp signup was cancelled or not completed.')
        return
      }

      const code = response.authResponse.code
      const accessToken = response.authResponse.accessToken
      if (!code && !accessToken) {
        toast.error('Could not obtain authorization data from Facebook.')
        return
      }

      const body: Record<string, string> = {
        redirectUri: window.location.origin,
      }
      if (code) {
        body.code = code
      } else if (accessToken) {
        body.accessToken = accessToken
      }

      const res = await fetch('/api/meta/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'WhatsApp connection failed. Please try again.')
        return
      }

      if (!data.success) {
        toast.error(data.error || 'WhatsApp connection failed. Please try again.')
        return
      }

      toast.success(
        connected ? 'WhatsApp reconnected successfully.' : 'WhatsApp connected successfully.',
      )
      onSuccess?.(data)
    } catch (err) {
      console.error('Connect WhatsApp failed:', err)
      toast.error(
        err instanceof Error
          ? err.message
          : 'Unable to complete Meta signup. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleConnect}
      disabled={disabled || loading}
      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
      size="lg"
    >
      {loading ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {connected ? 'Reconnecting...' : 'Connecting...'}
        </>
      ) : (
        <>
          {connected ? <RotateCcw className="size-4" /> : null}
          {connected ? 'Reconnect WhatsApp' : 'Connect WhatsApp'}
        </>
      )}
    </Button>
  )
}

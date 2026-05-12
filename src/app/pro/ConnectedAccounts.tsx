'use client'

/**
 * ConnectedAccounts — the photographer dashboard's photo-platform panel.
 *
 * Behaviour:
 *   - On mount, calls /api/connect/list to load the list of supported
 *     platforms + the photographer's existing connections.
 *   - Reads the URL's `?connect=success|denied|error&platform=...` so
 *     we can show a status toast after OAuth completes.
 *   - "Connect" → POSTs /api/connect/{platform}/start, redirects to
 *     the returned authorizeUrl.
 *   - "Disconnect" → confirms, POSTs /api/connect/{platform}/disconnect,
 *     reloads to refresh the list.
 *
 * Visual style matches the rest of /pro (pro.css). No external deps.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

interface SupportedPlatform {
  id: 'dropbox' | 'smugmug'
  displayName: string
  configured: boolean
}

interface ConnectedAccount {
  platform: 'dropbox' | 'smugmug'
  username: string
  displayName?: string
  status: 'active' | 'revoked' | 'error'
  connectedAt: string
  lastSyncAt?: string
  errorMessage?: string
  galleryCount?: number
}

interface ListResponse {
  ok: boolean
  platforms: SupportedPlatform[]
  connected: ConnectedAccount[]
}

interface Toast {
  kind: 'success' | 'error' | 'info'
  msg: string
}

export function ConnectedAccounts() {
  const search = useSearchParams()
  const [platforms, setPlatforms] = useState<SupportedPlatform[]>([])
  const [connected, setConnected] = useState<ConnectedAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null) // platform id of in-flight action
  const [toast, setToast] = useState<Toast | null>(null)

  const showToast = useCallback((t: Toast, ms = 6000) => {
    setToast(t)
    setTimeout(() => setToast(null), ms)
  }, [])

  // Read OAuth callback status from the URL on first load
  useEffect(() => {
    if (!search) return
    const status = search.get('connect')
    const platform = search.get('platform') || ''
    if (!status) return
    if (status === 'success') {
      showToast({ kind: 'success', msg: `Connected to ${platformName(platform)} successfully.` })
    } else if (status === 'denied') {
      showToast({ kind: 'info', msg: `${platformName(platform)} connection cancelled.` })
    } else if (status === 'error') {
      const detail = search.get('detail')
      showToast({ kind: 'error', msg: `${platformName(platform)} connection failed${detail ? ': ' + detail : ''}` })
    }
    // Clean up the URL so refreshes don't re-toast
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('connect')
      url.searchParams.delete('platform')
      url.searchParams.delete('detail')
      window.history.replaceState({}, '', url.toString())
    }
  }, [search, showToast])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/connect/list')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as ListResponse
      setPlatforms(j.platforms ?? [])
      setConnected(j.connected ?? [])
    } catch (e) {
      showToast({ kind: 'error', msg: `Couldn't load connected accounts: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    load()
  }, [load])

  const onConnect = useCallback(async (platformId: string) => {
    setBusy(platformId)
    try {
      const r = await fetch(`/api/connect/${platformId}/start`, { method: 'POST' })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const j = (await r.json()) as { authorizeUrl: string }
      window.location.href = j.authorizeUrl
    } catch (e) {
      setBusy(null)
      showToast({ kind: 'error', msg: `Couldn't start connection: ${e instanceof Error ? e.message : String(e)}` })
    }
  }, [showToast])

  const onDisconnect = useCallback(async (platformId: string) => {
    const ok = window.confirm(`Disconnect ${platformName(platformId)}? Existing projects will keep working but new projects won't be able to use this account.`)
    if (!ok) return
    setBusy(platformId)
    try {
      const r = await fetch(`/api/connect/${platformId}/disconnect`, { method: 'POST' })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const j = (await r.json()) as { ok: boolean; revokeError: string | null }
      showToast({
        kind: 'success',
        msg: j.revokeError
          ? `Disconnected locally. (Couldn't revoke on ${platformName(platformId)} — visit their settings to fully remove access.)`
          : `Disconnected from ${platformName(platformId)}.`,
      })
      await load()
    } catch (e) {
      showToast({ kind: 'error', msg: `Disconnect failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }, [showToast, load])

  return (
    <section style={{ marginBottom: 32 }}>
      <h2 className="pro-section-heading">Connected accounts</h2>
      <p style={{ fontSize: 12, color: '#6b5e4d', marginTop: 0, marginBottom: 14, lineHeight: 1.6, maxWidth: 600 }}>
        Optional. Connect your SmugMug or Dropbox so clients can pick photos directly from a gallery — no
        re-uploading to us. Read-only; you can disconnect any time.
      </p>

      {loading ? (
        <div style={{ fontSize: 13, color: '#6b5e4d' }}>Loading…</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {platforms.map((p) => {
            const conn = connected.find((c) => c.platform === p.id)
            return (
              <PlatformCard
                key={p.id}
                platform={p}
                connection={conn}
                busy={busy === p.id}
                onConnect={() => onConnect(p.id)}
                onDisconnect={() => onDisconnect(p.id)}
              />
            )
          })}
        </div>
      )}

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}
    </section>
  )
}

function PlatformCard({
  platform,
  connection,
  busy,
  onConnect,
  onDisconnect,
}: {
  platform: SupportedPlatform
  connection?: ConnectedAccount
  busy: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  const isConnected = !!connection && connection.status === 'active'
  const isError = !!connection && connection.status !== 'active'

  return (
    <div
      style={{
        background: '#fff',
        border: `0.5px solid ${isError ? '#d8a8a8' : isConnected ? '#a8d8b8' : '#e1d8c4'}`,
        borderRadius: 10,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 16, fontFamily: 'var(--font-display, "Cormorant Garamond", serif)', fontWeight: 500 }}>
          {platform.displayName}
        </div>
        <span
          style={{
            fontSize: 9,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            padding: '2px 8px',
            borderRadius: 30,
            background: isConnected ? '#e7f5ec' : isError ? '#fbecec' : '#f5efdf',
            color: isConnected ? '#2a6a3f' : isError ? '#7a2828' : '#6b5e4d',
            border: `0.5px solid ${isConnected ? '#a8d8b8' : isError ? '#d8a8a8' : '#e1d8c4'}`,
          }}
        >
          {isConnected ? 'Connected' : isError ? connection!.status : 'Not connected'}
        </span>
      </div>

      {!platform.configured && (
        <div style={{ fontSize: 11, color: '#8a6800', background: '#fbf2db', padding: '6px 10px', borderRadius: 4, border: '0.5px solid #e6cf8b' }}>
          Coming soon — platform credentials not configured yet.
        </div>
      )}

      {connection && (
        <div style={{ fontSize: 12, color: '#1a1410', lineHeight: 1.6 }}>
          <div>
            <strong>{connection.displayName || connection.username}</strong>
          </div>
          <div style={{ color: '#6b5e4d', fontSize: 11 }}>
            @{connection.username}
          </div>
          <div style={{ color: '#6b5e4d', fontSize: 11, marginTop: 4 }}>
            Connected {new Date(connection.connectedAt).toLocaleDateString()}
            {connection.galleryCount !== undefined && ` · ${connection.galleryCount} galleries`}
          </div>
          {connection.errorMessage && (
            <div style={{ color: '#7a2828', fontSize: 11, marginTop: 4 }}>
              {connection.errorMessage}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!connection && platform.configured && (
          <button
            type="button"
            className="pro-action-primary"
            onClick={onConnect}
            disabled={busy}
            style={{ opacity: busy ? 0.5 : 1 }}
          >
            {busy ? 'Opening…' : `Connect ${platform.displayName}`}
          </button>
        )}
        {connection && (
          <>
            <button
              type="button"
              className="pro-action-secondary"
              onClick={onDisconnect}
              disabled={busy}
              style={{ opacity: busy ? 0.5 : 1 }}
            >
              {busy ? 'Working…' : 'Disconnect'}
            </button>
            {isError && platform.configured && (
              <button
                type="button"
                className="pro-action-primary"
                onClick={onConnect}
                disabled={busy}
                style={{ opacity: busy ? 0.5 : 1 }}
              >
                Reconnect
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const bg = toast.kind === 'success' ? '#e7f5ec' : toast.kind === 'error' ? '#fbecec' : '#f5efdf'
  const fg = toast.kind === 'success' ? '#2a6a3f' : toast.kind === 'error' ? '#7a2828' : '#6b5e4d'
  const border = toast.kind === 'success' ? '#a8d8b8' : toast.kind === 'error' ? '#d8a8a8' : '#e1d8c4'
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        background: bg,
        color: fg,
        border: `0.5px solid ${border}`,
        padding: '10px 14px',
        borderRadius: 8,
        fontSize: 13,
        maxWidth: 360,
        boxShadow: '0 6px 22px rgba(26, 20, 16, 0.12)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        zIndex: 9999,
      }}
    >
      <span>{toast.msg}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: 16,
          color: fg,
          cursor: 'pointer',
          padding: 0,
          marginLeft: 6,
        }}
      >
        ×
      </button>
    </div>
  )
}

function platformName(id: string): string {
  switch (id) {
    case 'dropbox': return 'Dropbox'
    case 'smugmug': return 'SmugMug'
    default: return id || 'platform'
  }
}

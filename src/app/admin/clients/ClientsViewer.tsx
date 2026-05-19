'use client'

import { useCallback, useEffect, useState } from 'react'

interface ClientRecord {
  name: string
  email: string
  phone: string
  verifiedAt: string
}

function csvCell(v: string): string {
  // Wrap in quotes if it contains comma/quote/newline; double inner quotes.
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"'
  return v
}

export function ClientsViewer() {
  const [clients, setClients] = useState<ClientRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/clients')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { clients: ClientRecord[] }
      setClients(j.clients || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = clients.filter((c) => {
    if (!q.trim()) return true
    const s = q.trim().toLowerCase()
    return (
      c.name.toLowerCase().includes(s) ||
      c.email.toLowerCase().includes(s) ||
      c.phone.toLowerCase().includes(s)
    )
  })

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Phone', 'Verified at']
    const rows = filtered.map((c) => [
      c.name,
      c.email,
      c.phone,
      c.verifiedAt,
    ])
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvCell(String(cell ?? ''))).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `folio-clients-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const fmt = (iso: string) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <input
          placeholder="Search name, email, phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{
            flex: '1 1 240px',
            padding: '9px 12px',
            borderRadius: 8,
            border: '1px solid #d8cdb8',
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="admin-logout"
          style={{ cursor: filtered.length ? 'pointer' : 'not-allowed' }}
        >
          ⬇ Export CSV ({filtered.length})
        </button>
        <button type="button" onClick={load} className="admin-logout">
          ↻ Refresh
        </button>
      </div>

      {loading && <p style={{ color: '#6b5e4d', fontSize: 13 }}>Loading clients…</p>}
      {error && (
        <p style={{ color: '#b4453a', fontSize: 13 }}>Could not load: {error}</p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p style={{ color: '#6b5e4d', fontSize: 13 }}>
          {clients.length === 0
            ? 'No clients have registered yet.'
            : 'No clients match that search.'}
        </p>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', color: '#6b5e4d' }}>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid #d8cdb8' }}>Name</th>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid #d8cdb8' }}>Email</th>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid #d8cdb8' }}>Phone</th>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid #d8cdb8' }}>Verified</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.email}>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #efe7d6' }}>
                    {c.name || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #efe7d6' }}>
                    <a href={`mailto:${c.email}`} style={{ color: '#9a7b3f' }}>
                      {c.email}
                    </a>
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: '1px solid #efe7d6' }}>
                    {c.phone ? (
                      <a href={`tel:${c.phone}`} style={{ color: '#9a7b3f' }}>
                        {c.phone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid #efe7d6',
                      color: '#6b5e4d',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fmt(c.verifiedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

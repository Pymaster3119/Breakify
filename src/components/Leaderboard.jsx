import React, { useEffect, useState } from 'react'

function formatSecs(secs) {
  const s = Number(secs || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export default function Leaderboard({ onClose }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [me, setMe] = useState(null)

  useEffect(() => {
    let mounted = true
    // fetch current user and leaderboard in parallel
    Promise.all([
      fetch('http://localhost:6767/api/me', { credentials: 'include' }).then(r => r.json()).catch(() => ({ user: null })),
      fetch('http://localhost:6767/api/leaderboard', { credentials: 'include' }).then(r => r.json()).catch(() => ({ ok: false }))
    ]).then(([meData, lbData]) => {
      if (!mounted) return
      setMe(meData && meData.user ? meData.user : null)
      if (lbData && lbData.ok) setRows(lbData.leaderboard)
      else setErr((lbData && lbData.error) || 'Failed to load leaderboard')
    }).catch(() => { if (mounted) setErr('Network error') })
    return () => { mounted = false }
  }, [])

  const handleClose = () => {
    if (onClose) return onClose()
    if (window.history && window.history.back) window.history.back()
  }

  return (
    <div style={{position:'fixed',inset:0,background:'linear-gradient(180deg,#0f172a 0%, #0b1220 60%)',color:'#e6eef8',zIndex:9999,display:'flex',flexDirection:'column'}}>
      <style>{`
        .bf-leaderboard-wrap { padding:48px 32px; display:flex; flex-direction:column; align-items:center; gap:18px; }
        .bf-card { width:min(1200px,96%); background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)); border-radius:14px; padding:22px; box-shadow: 0 10px 30px rgba(2,6,23,0.6); backdrop-filter: blur(6px); }
        .bf-title { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .bf-title h1 { margin:0; font-size:28px; letter-spacing:0.6px; }
        .bf-sub { color:#9fb2d6; font-size:14px }
        .bf-table { width:100%; border-collapse:collapse; margin-top:12px }
        .bf-table thead th { text-align:left; color:#9fb2d6; padding:12px 10px; font-size:13px }
        .bf-table tbody tr { transition: transform 220ms ease, background 220ms ease; }
        .bf-table tbody tr:hover { transform: translateY(-4px); background: rgba(255,255,255,0.02); }
        .bf-row-rank { width:72px; font-weight:700; font-size:16px }
        .bf-username { font-weight:600 }
        .bf-highlight { background: linear-gradient(90deg, rgba(6,182,212,0.08), rgba(96,165,250,0.04)); border-left:4px solid rgba(6,182,212,0.18); }
        .medal { font-size:18px; margin-right:8px }
        @media (max-width:720px) { .bf-title h1 { font-size:20px } .bf-card { padding:14px } .bf-table thead { display:none } .bf-table tbody td { display:block; padding:8px 6px } .bf-row-rank { width:auto } }
      `}</style>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 28px 0 28px'}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button onClick={handleClose} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.06)',color:'#cfe8ff',padding:'8px 12px',borderRadius:8,cursor:'pointer'}}>← Back</button>
          <div style={{display:'flex',flexDirection:'column'}}>
            <div style={{fontSize:18,fontWeight:700}}>Breakify Leaderboard</div>
            <div style={{fontSize:12,color:'#9fb2d6'}}>{rows ? `Top ${rows.length}` : 'Loading...'}</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{fontSize:13,color:'#9fb2d6'}}>Logged in as</div>
          <div style={{fontWeight:700}}>{me ? me.name : 'Guest'}</div>
        </div>
      </div>

      <div className="bf-leaderboard-wrap" style={{flex:1,overflow:'auto'}}>
        <div className="bf-card">
          <div className="bf-title">
            <div>
              <h1>Top Focused Users</h1>
              <div className="bf-sub">Ranked by total focused time. Celebrate consistency — small steps build habits.</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{fontSize:12,color:'#9fb2d6',textAlign:'right'}}>Last updated: {new Date().toLocaleString()}</div>
            </div>
          </div>

          {!rows && !err && <div style={{padding:28,textAlign:'center'}}>Loading leaderboard…</div>}
          {err && <div style={{padding:24,color:'#ffb4b4',textAlign:'center'}}>{err}</div>}

          {rows && (
            <table className="bf-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>User</th>
                  <th>Total Focused</th>
                  <th>Sessions</th>
                  <th>Focus Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isMe = me && me.name === r.username
                  const cls = isMe ? 'bf-highlight' : ''
                  let medal = ''
                  if (i === 0) medal = '🥇'
                  else if (i === 1) medal = '🥈'
                  else if (i === 2) medal = '🥉'
                  return (
                    <tr key={r.username} className={cls} style={{padding:'8px 0'}}>
                      <td className="bf-row-rank">{i < 3 ? (<span style={{display:'inline-flex',alignItems:'center'}}><span className="medal">{medal}</span>{i+1}</span>) : i+1}</td>
                      <td className="bf-username">{r.username}{isMe ? ' • you' : ''}</td>
                      <td>{formatSecs(r.total_seconds)}</td>
                      <td>{r.session_count}</td>
                      <td>{(() => {
                        const total = Number(r.session_count || 0)
                        // try a few common field names for unfocused session count
                        const unfocused = Number(r.unfocused_sessions ?? r.unfocused ?? r.unfocused_count ?? r.unfocusedSessions ?? r.sessions_unfocused ?? 0)
                        if (!total) return '—'
                        const score = Math.round((1 - (unfocused / total)) * 100)
                        return `${score}%`
                      })()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

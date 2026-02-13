import React, { useState, useEffect } from 'react'

const API_BASE = 'https://breakify-backend.onrender.com'

export default function SignIn({ onSignIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [schools, setSchools] = useState([])
  const [selectedSchoolId, setSelectedSchoolId] = useState('')
  const [newSchoolName, setNewSchoolName] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const logCookie = label => {
    try {
      console.debug('[cookie]', label, { cookie: document.cookie, origin: window.location.origin, at: new Date().toISOString() })
    } catch (e) {}
  }

  const submit = async e => {
    e.preventDefault()
    setMsg('')
    const u = username.trim()
    const p = password
    const em = email.trim()
    if (!u) return setMsg('Please enter a username')
    if (!p) return setMsg('Please enter a password')
    if (isRegistering && !em) return setMsg('Please enter an email')
    if (isRegistering && selectedSchoolId === 'new' && !newSchoolName.trim()) return setMsg('Please enter a school name')

    const endpoint = isRegistering ? '/api/register' : '/api/login'
    console.debug('[auth] submitting', { endpoint, url: API_BASE + endpoint, username: u, withCredentials: true, cookies: document.cookie })
    setLoading(true)
    logCookie('before auth fetch')
    try {
      const body = { username: u, password: p, ...(isRegistering && { email: em }) }
      if (isRegistering) {
        if (selectedSchoolId && selectedSchoolId !== 'new') body.school_id = selectedSchoolId
        if (selectedSchoolId === 'new' && newSchoolName.trim()) body.school_name = newSchoolName.trim()
      }

      const res = await fetch(API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      })
      const allHeaders = Object.fromEntries(res.headers.entries())
      console.debug('[auth] response', {
        status: res.status,
        ok: res.ok,
        url: res.url,
        redirected: res.redirected,
        type: res.type,
        headers: allHeaders
      })
      console.debug('[auth] CORS/Cookie checks:', {
        'Access-Control-Allow-Credentials': allHeaders['access-control-allow-credentials'],
        'Access-Control-Allow-Origin': allHeaders['access-control-allow-origin'],
        'Set-Cookie': allHeaders['set-cookie'] || '(not visible in JS - check Network tab)',
        'Expected Origin': window.location.origin
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(data.error || data.detail || 'Server error')
        setLoading(false)
        return
      }
      // success
      setLoading(false)
      logCookie('after login immediate')
      setTimeout(() => logCookie('after login +500ms'), 500)
      console.debug('[auth] success, user payload', data.user, 'token present', !!data.token)
      onSignIn({ ...(data.user || { name: u }), token: data.token })
    } catch (err) {
      console.error(err)
      setMsg('Failed to contact server')
      setLoading(false)
    }
  }

  useEffect(() => {
    // fetch schools when user switches to registration mode
    let mounted = true
    if (!isRegistering) return
    setSchools([])
    ;(async () => {
      try {
        const res = await fetch(API_BASE + '/api/schools')
        if (!res.ok) return
        const data = await res.json()
        if (!mounted) return
        setSchools(data.schools || [])
      } catch (err) {
        console.debug('failed to load schools', err)
      }
    })()
    return () => { mounted = false }
  }, [isRegistering])

  const continueAsGuest = () => {
    onSignIn({ name: 'Guest', isGuest: true })
  }

  return (
    <div className="modal-card">
      <form onSubmit={submit}>
        <h2 style={{marginTop:0,marginBottom:8}}>{isRegistering ? 'Create account' : 'Sign in'}</h2>

        <div className="form-row">
          <label className="label">Username</label>
          <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" autoFocus />
        </div>

        <div className="form-row">
          <label className="label">Password</label>
          <input className="input" value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" />
        </div>

        {isRegistering && (
        <>
          <div className="form-row">
            <label className="label">Email</label>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email" />
          </div>

          <div className="form-row">
            <label className="label">School</label>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <select className="input" value={selectedSchoolId} onChange={e => setSelectedSchoolId(e.target.value)} style={{flex:1}}>
                <option value="">-- choose a school --</option>
                <option value="new">➕ Add a new school...</option>
                {schools.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {selectedSchoolId === 'new' && (
            <div className="form-row">
              <label className="label">New school name</label>
              <input className="input" value={newSchoolName} onChange={e => setNewSchoolName(e.target.value)} placeholder="e.g. Acme University" />
            </div>
          )}
        </>
        )}

        {msg && <div style={{color: 'var(--danger)', marginBottom:12}}>{msg}</div>}

        <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
          <div>
            <button type="button" onClick={() => setIsRegistering(s => !s)} className="btn ghost">{isRegistering ? 'Have an account?' : 'Create account'}</button>
          </div>

          <div style={{display:'flex',gap:8}}>
            <button type="button" onClick={continueAsGuest} className="btn secondary">Continue as guest</button>
            <button type="submit" disabled={loading} className="btn primary">{loading ? 'Please wait...' : (isRegistering ? 'Create' : 'Sign in')}</button>
          </div>
        </div>
      </form>
    </div>
  )
}

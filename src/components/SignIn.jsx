import React, { useState } from 'react'

const API_BASE = 'https://breakify-backend.onrender.com'

export default function SignIn({ onSignIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async e => {
    e.preventDefault()
    setMsg('')
    const u = username.trim()
    const p = password
    if (!u) return setMsg('Please enter a username')
    if (!p) return setMsg('Please enter a password')

    const endpoint = isRegistering ? '/api/register' : '/api/login'
    console.debug('[auth] submitting', { endpoint, url: API_BASE + endpoint, username: u, withCredentials: true, cookies: document.cookie })
    setLoading(true)
    try {
      const res = await fetch(API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: u, password: p })
      })
      console.debug('[auth] response', {
        status: res.status,
        ok: res.ok,
        url: res.url,
        redirected: res.redirected,
        type: res.type,
        headers: Object.fromEntries(res.headers.entries())
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(data.error || data.detail || 'Server error')
        setLoading(false)
        return
      }
      // success
      setLoading(false)
      console.debug('[auth] success, user payload', data.user)
      onSignIn(data.user || { name: u })
    } catch (err) {
      console.error(err)
      setMsg('Failed to contact server')
      setLoading(false)
    }
  }

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

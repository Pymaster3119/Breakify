import React, { useState } from 'react'

export default function SignIn({ onSignIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async e => {
    e.preventDefault()
    setMsg('')
    const u = username.trim()
    let p = password
    if (!u) return setMsg('Please enter a username')
    if (!p) return setMsg('Please enter a password')
    p = await (async () => {
      const enc = new TextEncoder()
      const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(p))
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
    })()

    const endpoint = isRegistering ? 'http://localhost:6767/api/register' : 'http://localhost:6767/api/login'
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: u, password: p })
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(data.error || data.detail || 'Server error')
        return
      }
      // success
      onSignIn(data.user || { name: u })
    } catch (err) {
      console.error(err)
      setMsg('Failed to contact server')
    }
  }

  const continueAsGuest = () => {
    onSignIn({ name: 'Guest', isGuest: true })
  }

  return (
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <form onSubmit={submit} style={{background:'rgba(0,0,0,0.85)',padding:24,borderRadius:8,color:'#fff',minWidth:320}}>
        <h2 style={{marginTop:0,marginBottom:8}}>{isRegistering ? 'Create account' : 'Sign in'}</h2>

        <div style={{marginBottom:12}}>
          <label style={{display:'block',fontSize:13,marginBottom:6}}>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)} style={{width:'100%',padding:8,borderRadius:6,border:'1px solid #333'}} placeholder="Username" autoFocus />
        </div>

        <div style={{marginBottom:12}}>
          <label style={{display:'block',fontSize:13,marginBottom:6}}>Password</label>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" style={{width:'100%',padding:8,borderRadius:6,border:'1px solid #333'}} placeholder="Password" />
        </div>

        {msg && <div style={{color:'#ffdcdc',marginBottom:12}}>{msg}</div>}

        <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
          <div>
            <button type="button" onClick={() => setIsRegistering(s => !s)} style={{padding:'8px 10px',borderRadius:6,border:'1px solid #234',background:'transparent',color:'#9ad'}}> {isRegistering ? 'Have an account?' : 'Create account'}</button>
          </div>

          <div style={{display:'flex',gap:8}}>
            <button type="button" onClick={continueAsGuest} style={{padding:'8px 12px',borderRadius:6,border:'none',background:'#64748b',color:'#fff'}}>Continue as guest</button>
            <button type="submit" style={{padding:'8px 12px',borderRadius:6,border:'none',background:'#06b6d4',color:'#042',fontWeight:700}}>{isRegistering ? 'Create' : 'Sign in'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}

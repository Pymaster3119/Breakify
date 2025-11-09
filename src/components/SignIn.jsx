import React, { useState } from 'react'

export default function SignIn({ onSignIn }) {
  const [name, setName] = useState('')

    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [isRegistering, setIsRegistering] = useState(false)
    const [msg, setMsg] = useState('')

    const USERS_KEY = 'breakify_users'

    const loadUsers = () => {
      try {
        const raw = localStorage.getItem(USERS_KEY)
        return raw ? JSON.parse(raw) : {}
      } catch (e) {
        return {}
      }
    }

    const saveUsers = users => {
      try { localStorage.setItem(USERS_KEY, JSON.stringify(users)) } catch (e) {}
    }

    const submit = e => {
      e.preventDefault()
      setMsg('')
      const u = username.trim()
      const p = password
      if (!u) return setMsg('Please enter a username')
      if (!p) return setMsg('Please enter a password')

      const users = loadUsers()

      if (isRegistering) {
        if (users[u]) return setMsg('Username already exists, choose another or sign in')
        // NOTE: storing password in localStorage in plaintext is not secure — this is a demo-only convenience.
        users[u] = { password: p }
        saveUsers(users)
        setMsg('Account created — signed in')
        onSignIn({ name: u, isGuest: false })
        return
      }

      // signing in
      if (!users[u]) return setMsg('No account found. Create one or continue as guest.')
      if (users[u].password !== p) return setMsg('Incorrect password')
      onSignIn({ name: u, isGuest: false })
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

  return (
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <form onSubmit={submit} style={{background:'rgba(0,0,0,0.7)',padding:24,borderRadius:8,color:'#fff',minWidth:300}}>
        <h2 style={{marginTop:0,marginBottom:8}}>Sign in</h2>
        <div style={{marginBottom:12}}>
          <label style={{display:'block',fontSize:13,marginBottom:6}}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} style={{width:'100%',padding:8,borderRadius:6,border:'1px solid #333'}} placeholder="Your name" />
        </div>
        <div style={{display:'flex',justifyContent:'flex-end'}}>
          <button type="submit" style={{padding:'8px 12px',borderRadius:6,border:'none',background:'#06b6d4',color:'#042',fontWeight:700}}>Sign in</button>
        </div>
      </form>
    </div>
  )
}

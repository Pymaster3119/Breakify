import React, { useState, useRef, useEffect } from 'react'
import WebcamFeed from './components/WebcamFeed'
import YoloDetector from './components/YoloDetector'
import SignIn from './components/SignIn'

export default function App() {
  const videoRef = useRef(null)
  // Timer state (seconds). Start at 0 (not counting). When a person is seen we reset to 30 minutes.
  const [timerSeconds, setTimerSeconds] = useState(0)
  const timerStartedRef = useRef(false)
  const START_SECONDS = 30 // development: 30 seconds
  const [phoneCount, setPhoneCount] = useState(0)
  const [user, setUser] = useState(null)
  // try to auto-login from server session
  useEffect(() => {
    let mounted = true
    fetch('/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (mounted && data && data.user) setUser(data.user) })
      .catch(() => {})
    return () => { mounted = false }
  }, [])
  const [isOnBreak, setIsOnBreak] = useState(false)
  const BREAK_TOTAL = 10
  const [breakSeconds, setBreakSeconds] = useState(0)

  // countdown effect
  useEffect(() => {
    let t = null
    if (timerSeconds > 0) {
      t = setInterval(() => {
        setTimerSeconds(s => Math.max(0, s - 1))
      }, 1000)
    }
    return () => { if (t) clearInterval(t) }
  }, [timerSeconds])

  // break countdown
  useEffect(() => {
    let bt = null
    if (breakSeconds > 0) {
      bt = setInterval(() => setBreakSeconds(s => Math.max(0, s - 1)), 1000)
    } else if (breakSeconds === 0 && isOnBreak) {
      // break finished
      setIsOnBreak(false)
      timerStartedRef.current = false // allow new work session to start on next person
    }
    return () => { if (bt) clearInterval(bt) }
  }, [breakSeconds, isOnBreak])

  // handle phone seen events from detector
  const handlePhoneSeen = () => {
    setPhoneCount(c => c + 1)
  }

  const formatTime = secs => {
    const total = secs > 0 ? secs : START_SECONDS
    const m = Math.floor(total / 60).toString().padStart(2, '0')
    const s = Math.floor(total % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // callback from detector about person presence
  // Start timer only once, when the first person is detected.
  const handlePersonPresent = present => {
    if (present && !timerStartedRef.current) {
      timerStartedRef.current = true
      setTimerSeconds(START_SECONDS)
    }
  }

  // audio chime when timer reaches zero
  const audioCtxRef = useRef(null)
  const playChime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      const ac = audioCtxRef.current || new AudioCtx()
      audioCtxRef.current = ac
      if (ac.state === 'suspended' && typeof ac.resume === 'function') ac.resume().catch(() => {})

      const now = ac.currentTime
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(880, now)
      // short bell-like envelope
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2)
      o.connect(g)
      g.connect(ac.destination)
      // descend frequency slightly
      o.frequency.linearRampToValueAtTime(660, now + 0.6)
      o.start(now)
      o.stop(now + 1.3)
      // cleanup after sound
      setTimeout(() => {
        try { g.disconnect(); o.disconnect() } catch (e) {}
      }, 1500)
    } catch (e) {
      console.warn('chime failed', e)
    }
  }

  // detect when timer reaches zero to play chime (only once per run)
  const prevTimerRef = useRef(timerSeconds)
  // prefer playing an MP3 file at /chime.mp3 (place file in project `public/` for vite),
  // fall back to generated chime when audio playback fails or file missing.
  const audioRef = useRef(null)
  const [flash, setFlash] = useState(false)

  // vibrate + flash fallback for environments where audio playback is blocked
  const vibrateAndFlashFallback = () => {
    try { if (navigator.vibrate) navigator.vibrate([200,100,200]) } catch (e) {}
    setFlash(true)
    setTimeout(() => setFlash(false), 900)
  }

  useEffect(() => {
    if (prevTimerRef.current > 0 && timerSeconds === 0 && timerStartedRef.current) {
      const a = audioRef.current
      if (a && typeof a.play === 'function') {
        a.play().catch(err => {
          console.warn('audio play failed, using fallback', err)
          // fallback to synth and vibration/flash
          playChime()
          vibrateAndFlashFallback()
        })
      } else {
        playChime()
        vibrateAndFlashFallback()
      }
      // start break timer when work session completes
      setIsOnBreak(true)
      setBreakSeconds(10) // 10 seconds break
    }
    prevTimerRef.current = timerSeconds
  }, [timerSeconds])

  const showSummary = timerStartedRef.current && timerSeconds === 0

  const [showSignIn, setShowSignIn] = useState(false)

  const handleSignIn = userObj => {
    setUser(userObj)
    setShowSignIn(false)
  }

  const handleSignOut = () => {
    // inform server and clear local state
    fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setUser(null)
  }

  return (
    <div className="app">
      <header className="header" style={{position:'relative',height:56}}>
        <div style={{position:'absolute',left:20,top:12}}>
          <div style={{background:'rgba(255,255,255,0.03)',padding:8,borderRadius:8}}>
            <small>Signed in as: {user?.name || (user?.isGuest ? 'Guest' : 'Not signed in')}</small>
          </div>
        </div>

        <div style={{position:'absolute',right:20,top:12}}>
          {user ? (
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <button onClick={handleSignOut} style={{padding:'6px 10px',borderRadius:6}}>Sign out</button>
            </div>
          ) : (
            <button onClick={() => setShowSignIn(true)} style={{padding:'6px 10px',borderRadius:6}}>Sign in</button>
          )}
        </div>
      </header>

      <main className="main">
        <section className="preview">
          <div>
            <WebcamFeed forwardedRef={videoRef} showVideo={false} autoStart={true} />
            <YoloDetector videoRef={videoRef} enabled={!isOnBreak} onPersonPresent={handlePersonPresent} onPhoneSeen={handlePhoneSeen} />
          </div>
          {/* integrated central summary: when the work timer has finished, show the session summary
              and the break countdown in the main center area instead of a separate overlay */}
          <div style={{position:'absolute',left:0,right:0,top:0,bottom:0,display:'flex',justifyContent:'center',alignItems:'center',pointerEvents:'none'}}>
            <div style={{textAlign:'center',width:'100%',pointerEvents:'auto'}}>
              <div style={{marginBottom:16}}>
                <div style={{color:'#fff',fontSize:28,fontWeight:700}}>
                  {(isOnBreak ? 'Break time!' : 'Work time!')}
                </div>
              </div>
              <div style={{background:'rgba(0,0,0,0)',color:'#fff',padding:'12px 24px',borderRadius:8,fontSize:'48vh',fontWeight:700,fontFamily:'monospace'}}>
                {timerSeconds === 0 && timerStartedRef.current ? formatTime(breakSeconds) : (isOnBreak ? formatTime(breakSeconds) : formatTime(timerSeconds))}
              </div>

              {/* hidden audio element: place a file at public/chime.mp3 (served as /chime.mp3) */}
              <audio ref={audioRef} src="/chime.mp3" preload="auto" />

              {/* session summary integrated below the timer when the session has finished */}
              {timerSeconds === 0 && timerStartedRef.current ? (
                <div style={{marginTop:18,color:'#fff'}}>
                  <div style={{fontSize:20}}>Phone was used <strong style={{fontSize:24}}>{phoneCount}</strong> time{phoneCount===1 ? '' : 's'} during this session.</div>
                </div>
              ) : null}

              {/* flash indicator (visible when chime fallback fires) */}
              {flash && (
                <div style={{position:'absolute',left:0,right:0,top:0,bottom:0,background:'rgba(255,255,255,0.08)',pointerEvents:'none'}} />
              )}

              {/* progress bar below clock */}
              <div style={{display:'flex',justifyContent:'center',marginTop:24}}>
                <div style={{width:'40vw',maxWidth:800,minWidth:200,height:12,background:'rgba(255,255,255,0.12)',borderRadius:8,overflow:'hidden'}}>
                  <div
                    style={{
                      height:'100%',
                      width: `${isOnBreak ? Math.max(0, Math.min(100, ((BREAK_TOTAL - (breakSeconds > 0 ? breakSeconds : BREAK_TOTAL)) / BREAK_TOTAL) * 100)).toFixed(2) + '%' : Math.max(0, Math.min(100, ((START_SECONDS - (timerSeconds > 0 ? timerSeconds : START_SECONDS)) / START_SECONDS) * 100)).toFixed(2) + '%'}`,
                      background: isOnBreak ? 'linear-gradient(90deg,#f97316,#f43f5e)' : 'linear-gradient(90deg,#4ade80,#06b6d4)',
                      transition: 'width 0.5s linear'
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
        {showSignIn && (
          <div style={{position:'fixed',left:0,top:0,right:0,bottom:0,zIndex:9999}}>
            <SignIn onSignIn={handleSignIn} />
          </div>
        )}
      </div>
  )
}

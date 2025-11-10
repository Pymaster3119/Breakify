import React, { useState, useRef, useEffect } from 'react'
import WebcamFeed from './components/WebcamFeed'
import YoloDetector from './components/YoloDetector'
import SignIn from './components/SignIn'
import Leaderboard from './components/Leaderboard'
import Settings from './components/Settings'

export default function App() {
  const videoRef = useRef(null)
  // Timer state (seconds). Start at 0 (not counting). When a person is seen we reset to configured work length.
  const [timerSeconds, setTimerSeconds] = useState(0)
  const timerStartedRef = useRef(false)
  // persisted settings (minutes)
  const [workMinutes, setWorkMinutes] = useState(() => {
    const v = parseInt(localStorage.getItem('bf_work_minutes'), 10)
    return Number.isFinite(v) && v > 0 ? v : 30
  })
  const [breakMinutes, setBreakMinutes] = useState(() => {
    const v = parseInt(localStorage.getItem('bf_break_minutes'), 10)
    return Number.isFinite(v) && v > 0 ? v : 10
  })

  const START_SECONDS = workMinutes * 60
  const [phoneCount, setPhoneCount] = useState(0)
  const [user, setUser] = useState(null)
  // try to auto-login from server session
  useEffect(() => {
    let mounted = true
    fetch('http://https://breakify-s9eu.onrender.com:6767/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then(async data => {
        if (!mounted) return
        if (data && data.user) {
          setUser(data.user)
          // try to load server-side settings for authenticated user
          try {
            const res = await fetch('http://https://breakify-s9eu.onrender.com:6767/api/settings', { credentials: 'include' })
            if (res.ok) {
              const jd = await res.json()
              if (jd && jd.ok && jd.settings) {
                const s = jd.settings
                if (s.work_minutes) setWorkMinutes(Number(s.work_minutes))
                if (s.break_minutes) setBreakMinutes(Number(s.break_minutes))
              }
            }
          } catch (e) {}
        }
      })
      .catch(() => {})
    return () => { mounted = false }
  }, [])
  const [isOnBreak, setIsOnBreak] = useState(false)
  const BREAK_TOTAL = breakMinutes * 60
  const [breakSeconds, setBreakSeconds] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  // session notes during break
  const [achievement, setAchievement] = useState('')
  const [nextGoals, setNextGoals] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)
  const [lastGoals, setLastGoals] = useState('')
  // tracking used break seconds (unscheduled breaks taken during work)
  const usedBreakSecondsRef = useRef(0)
  // store the break budget value when a break starts so we can compute elapsed if user ends early
  const breakBudgetAtStartRef = useRef(0)

  // countdown effect
  useEffect(() => {
    let t = null
    // pause work timer while on break
    if (timerSeconds > 0 && !isOnBreak) {
      t = setInterval(() => {
        setTimerSeconds(s => Math.max(0, s - 1))
      }, 1000)
    }
    return () => { if (t) clearInterval(t) }
  }, [timerSeconds, isOnBreak])

  // break countdown
  useEffect(() => {
    let bt = null
    if (breakSeconds > 0) {
      bt = setInterval(() => setBreakSeconds(s => Math.max(0, s - 1)), 1000)
    } else if (breakSeconds === 0 && isOnBreak) {
      // break finished
      // If timerSeconds === 0 and timerStartedRef.current is true, this was the scheduled break after a completed work session.
      if (timerSeconds === 0 && timerStartedRef.current) {
        // scheduled break finished
        setIsOnBreak(false)
        timerStartedRef.current = false // allow new work session to start on next person
        setPhoneCount(0) // reset phone detections after each break
        // reset used break seconds for next session
        usedBreakSecondsRef.current = 0
      } else {
        // unscheduled break ended because user consumed remaining break budget or ended early via UI
        // compute elapsed break seconds from this break and accumulate
        try {
          const startBudget = breakBudgetAtStartRef.current || 0
          const elapsed = startBudget - 0 // since breakSeconds === 0
          usedBreakSecondsRef.current = (usedBreakSecondsRef.current || 0) + (elapsed > 0 ? elapsed : 0)
        } catch (e) {}
        setIsOnBreak(false)
      }
    }
    return () => { if (bt) clearInterval(bt) }
  }, [breakSeconds, isOnBreak])

  // handle phone seen events from detector
  const handlePhoneSeen = () => {
    setPhoneCount(c => c + 1)
  }

  // Start an unscheduled break during an active work session. This consumes from the session's break budget.
  const startUnscheduledBreak = () => {
    if (isOnBreak) return
    if (!timerStartedRef.current || timerSeconds <= 0) return
    const remainingBudget = Math.max(0, BREAK_TOTAL - (usedBreakSecondsRef.current || 0))
    if (remainingBudget <= 0) return // no break time left
    breakBudgetAtStartRef.current = remainingBudget
    setBreakSeconds(remainingBudget)
    setIsOnBreak(true)
  }

  // End an unscheduled break early (before the scheduled session end). Accumulate used break seconds.
  const endUnscheduledBreak = () => {
    if (!isOnBreak) return
    // only treat as unscheduled if work timer still has time remaining
    if (timerSeconds > 0) {
      const startBudget = breakBudgetAtStartRef.current || 0
      const elapsed = Math.max(0, startBudget - (breakSeconds || 0))
      usedBreakSecondsRef.current = (usedBreakSecondsRef.current || 0) + elapsed
      // stop break and resume work timer
      setIsOnBreak(false)
    }
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
      // report completed work session to backend (for registered users)
      try {
        if (user && !user.isGuest) {
          fetch('http://https://breakify-s9eu.onrender.com/api/session', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration_seconds: START_SECONDS, phone_count: phoneCount })
          }).catch(() => {})
        }
      } catch (e) {}

      // start break timer when work session completes
  setIsOnBreak(true)
  // scheduled break should be reduced by any unscheduled break time already taken
  const scheduledRemaining = Math.max(0, BREAK_TOTAL - (usedBreakSecondsRef.current || 0))
  setBreakSeconds(scheduledRemaining)
  breakBudgetAtStartRef.current = scheduledRemaining
      // prepare notes for new break: clear achievement, load last session's goals into separate box
      setAchievement('')
      try {
        const raw = localStorage.getItem('bf_last_session_notes')
        if (raw) {
          const parsed = JSON.parse(raw)
          setLastGoals(parsed?.next_goals || '')
        } else {
          setLastGoals('')
        }
      } catch (e) {
        setLastGoals('')
      }
      // keep the current Goals textarea empty for the new break
      setNextGoals('')
      // show the inputs again for the new break
      setNotesSaved(false)
    }
    prevTimerRef.current = timerSeconds
  }, [timerSeconds])

  const showSummary = timerStartedRef.current && timerSeconds === 0

  const [showSignIn, setShowSignIn] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  
  // handle settings save
  const handleSaveSettings = ({ workMinutes: w, breakMinutes: b }) => {
    setWorkMinutes(w)
    setBreakMinutes(b)
    try {
      localStorage.setItem('bf_work_minutes', String(w))
      localStorage.setItem('bf_break_minutes', String(b))
    } catch (e) {}
    // if user logged in, persist on server
    try {
      if (user && user.name) {
        fetch('http://https://breakify-s9eu.onrender.com/api/settings', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ work_minutes: w, break_minutes: b })
        }).catch(() => {})
      }
    } catch (e) {}
    setShowSettings(false)
  }
  // sync showLeaderboard with history (/leaderboard path)
  useEffect(() => {
    const updateFromLocation = () => setShowLeaderboard(window.location.pathname === '/leaderboard')
    updateFromLocation()
    window.addEventListener('popstate', updateFromLocation)
    return () => window.removeEventListener('popstate', updateFromLocation)
  }, [])

  const handleSignIn = userObj => {
    setUser(userObj)
    setShowSignIn(false)
    // load server-side settings after sign in
    (async () => {
      try {
        const res = await fetch('http://https://breakify-s9eu.onrender.com/api/settings', { credentials: 'include' })
        if (res.ok) {
          const jd = await res.json()
          if (jd && jd.ok && jd.settings) {
            const s = jd.settings
            if (s.work_minutes) setWorkMinutes(Number(s.work_minutes))
            if (s.break_minutes) setBreakMinutes(Number(s.break_minutes))
          }
        }
      } catch (e) {}
    })()
  }

  const handleSignOut = () => {
    // inform server and clear local state
    fetch('http://https://breakify-s9eu.onrender.com/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setUser(null)
  }
  const progressPct = isOnBreak
    ? Math.max(0, Math.min(100, ((BREAK_TOTAL - (breakSeconds > 0 ? breakSeconds : BREAK_TOTAL)) / BREAK_TOTAL) * 100))
    : Math.max(0, Math.min(100, ((START_SECONDS - (timerSeconds > 0 ? timerSeconds : START_SECONDS)) / START_SECONDS) * 100))
  const progressWidth = `${progressPct.toFixed(2)}%`

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">Breakify</div>
          <div className="signed-in">Signed in as: {user?.name || (user?.isGuest ? 'Guest' : 'Not signed in')}</div>
        </div>

        <div className="header-right">
          <button className="btn ghost" onClick={() => setShowSettings(true)}>Settings</button>
          <button className="btn ghost" onClick={() => { window.history.pushState({page:'leaderboard'}, '', '/leaderboard'); setShowLeaderboard(true) }}>Leaderboard</button>
          {user ? (
            <button className="btn ghost" onClick={handleSignOut}>Sign out</button>
          ) : (
            <button className="btn primary" onClick={() => setShowSignIn(true)}>Sign in</button>
          )}
        </div>
      </header>

      {showLeaderboard ? (
        <main className="main">
          <div style={{padding:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <h2 style={{margin:0}}>Leaderboard</h2>
              <div>
                <button className="btn secondary" onClick={() => window.history.back()}>Back</button>
              </div>
            </div>
            <Leaderboard onClose={() => window.history.back()} />
          </div>
        </main>
      ) : (
        <main className="main">
          <section className="preview">
            <div>
              <WebcamFeed forwardedRef={videoRef} showVideo={false} autoStart={true} />
              <YoloDetector videoRef={videoRef} enabled={!isOnBreak} onPersonPresent={handlePersonPresent} onPhoneSeen={handlePhoneSeen} />
            </div>

            <div className="timer-overlay">
              <div className="timer-card">
                <div className="timer-title">{(isOnBreak ? 'Break time!' : 'Work time!')}</div>
                <div className="timer-clock">{timerSeconds === 0 && timerStartedRef.current ? formatTime(breakSeconds) : (isOnBreak ? formatTime(breakSeconds) : formatTime(timerSeconds))}</div>

                <audio ref={audioRef} src="/chime.mp3" preload="auto" />

                {timerSeconds === 0 && timerStartedRef.current ? (
                  <div className="session-summary"> This was a <strong style={{fontSize:18}}>{phoneCount > 0 ? 'unfocused' : 'highly focused'}</strong> session </div>
                ) : null}

                {/* allow taking an unscheduled break during an active work session */}
                {!isOnBreak && timerStartedRef.current && timerSeconds > 0 ? (
                  <div style={{marginTop:8}}>
                    <button className="btn secondary" onClick={startUnscheduledBreak}>Take break (use break time)</button>
                  </div>
                ) : null}

                {/* allow ending an unscheduled break early and resume work */}
                {isOnBreak && timerSeconds > 0 ? (
                  <div style={{marginTop:8,display:'flex',justifyContent:'flex-end'}}>
                    <button className="btn ghost" onClick={endUnscheduledBreak}>End break</button>
                  </div>
                ) : null}

                {/* session notes shown during break */}
                {isOnBreak && (
                  <div style={{marginTop:12}}>
                    {!notesSaved ? (
                      <>
                        {lastGoals ? (
                          <div style={{marginBottom:8}}>
                            <label style={{fontSize:13,display:'block'}}>Last session, you aimed to complete these goals:</label>
                            <label style={{fontSize:15,display:'block'}}><strong>{lastGoals}</strong></label>
                          </div>
                        ) : null}
                        <div style={{marginBottom:8}}>
                          <label style={{fontSize:13,display:'block'}}>What did you achieve during this session?</label>
                          <textarea value={achievement} onChange={e => setAchievement(e.target.value)} rows={3} style={{width:'100%',marginTop:6,padding:8,borderRadius:6,border:'1px solid rgba(0,0,0,0.12)'}} />
                        </div>

                        <div style={{marginBottom:8}}>
                          <label style={{fontSize:13,display:'block'}}>Goals for the next session</label>
                          <textarea value={nextGoals} onChange={e => setNextGoals(e.target.value)} rows={2} style={{width:'100%',marginTop:6,padding:8,borderRadius:6,border:'1px solid rgba(0,0,0,0.12)'}} />
                        </div>

                        <div style={{display:'flex',justifyContent:'flex-end'}}>
                          <button
                            className="btn primary"
                            onClick={async () => {
                              const payload = { achievement, next_goals: nextGoals }
                              try {
                                // persist locally
                                try { localStorage.setItem('bf_last_session_notes', JSON.stringify(payload)) } catch (e) {}
                                // send to server for authenticated users
                                if (user && !user.isGuest) {
                                  await fetch('http://https://breakify-s9eu.onrender.com/api/session/notes', {
                                    method: 'POST',
                                    credentials: 'include',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(payload)
                                  })
                                }
                              } catch (e) {
                                console.warn('failed saving session notes', e)
                              }
                              // hide inputs after save
                              setNotesSaved(true)
                            }}
                          >Save</button>
                        </div>
                      </>
                    ) : (
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <div style={{color:'var(--muted)'}}>Session notes saved.</div>
                        <div>
                          <button className="btn ghost" onClick={() => setNotesSaved(false)}>Edit</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {flash && (
                  <div style={{position:'absolute',left:0,right:0,top:0,bottom:0,background:'rgba(255,255,255,0.08)',pointerEvents:'none'}} />
                )}

                <div className="progress-wrap">
                  <div className="progress">
                    <div className="bar" style={{width: progressWidth, background: isOnBreak ? 'linear-gradient(90deg,#f97316,#f43f5e)' : undefined}} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      )}

      {showSignIn && (
        <div className="bf-modal">
          <SignIn onSignIn={handleSignIn} />
        </div>
      )}

      {showSettings && (
        <div className="bf-modal">
          <Settings workMinutes={workMinutes} breakMinutes={breakMinutes} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />
        </div>
      )}
    </div>
  )
}

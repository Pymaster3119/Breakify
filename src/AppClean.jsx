import React, { useState, useRef, useEffect } from 'react'
import WebcamFeed from './components/WebcamFeed'
import YoloDetector from './components/YoloDetector'

export default function App() {
  const videoRef = useRef(null)
  // Timer state (seconds). Start at 0 (not counting). When a person is seen we reset to 30 minutes.
  const [timerSeconds, setTimerSeconds] = useState(0)
  const timerStartedRef = useRef(false)
  const START_SECONDS = 30 // development: 30 seconds
  const [phoneCount, setPhoneCount] = useState(0)

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
    }
    prevTimerRef.current = timerSeconds
  }, [timerSeconds])

  const showSummary = timerStartedRef.current && timerSeconds === 0

  return (
    <div className="app">
      <header className="header">
      </header>

      <main className="main">
        <section className="preview">
          <div>
            <WebcamFeed forwardedRef={videoRef} showVideo={false} autoStart={true} />
            <YoloDetector videoRef={videoRef} enabled={true} onPersonPresent={handlePersonPresent} onPhoneSeen={handlePhoneSeen} />
          </div>
          {showSummary && (
            <div style={{position:'absolute',left:0,top:0,right:0,bottom:0,background:'rgba(0,0,0,0.85)',display:'flex',justifyContent:'center',alignItems:'center',zIndex:40}}>
              <div style={{color:'#fff',textAlign:'center',padding:32,borderRadius:8,maxWidth:640}}>
                <h1 style={{margin:0,fontSize:48}}>Time's up</h1>
                <p style={{marginTop:12,fontSize:20}}>Phone was used <strong style={{fontSize:28}}>{phoneCount}</strong> time{phoneCount===1? '':'s'} during this session!</p>
                <div style={{marginTop:20}}>
                  <button onClick={() => {
                    // reset session for development: clear count and allow timer to be started again
                    timerStartedRef.current = false
                    setPhoneCount(0)
                    setTimerSeconds(0)
                  }} style={{padding:'8px 14px',borderRadius:6,border:'none',background:'#06b6d4',color:'#042',fontWeight:700}}>Start break!</button>
                </div>
              </div>
            </div>
          )}
          <div style={{position:'absolute',left:0,right:0,top:0,bottom:0,display:'flex',justifyContent:'center',alignItems:'center',pointerEvents:'none'}}>
            <div style={{textAlign:'center',width:'100%',pointerEvents:'auto'}}>
              <div style={{marginBottom:16}}>
                <div style={{color:'#fff',fontSize:28,fontWeight:700}}>Work time!</div>
              </div>
              <div style={{background:'rgba(0,0,0,0)',color:'#fff',padding:'12px 24px',borderRadius:8,fontSize:'48vh',fontWeight:700,fontFamily:'monospace'}}>
                {formatTime(timerSeconds)}
              </div>

              {/* hidden audio element: place a file at public/chime.mp3 (served as /chime.mp3) */}
              <audio ref={audioRef} src="/chime.mp3" preload="auto" />

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
                      width: `${Math.max(0, Math.min(100, ((START_SECONDS - (timerSeconds > 0 ? timerSeconds : START_SECONDS)) / START_SECONDS) * 100)).toFixed(2)}%`,
                      background: 'linear-gradient(90deg,#4ade80,#06b6d4)',
                      transition: 'width 0.5s linear'
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

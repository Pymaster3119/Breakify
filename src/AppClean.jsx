import React, { useState, useRef, useEffect } from 'react'
import WebcamFeed from './components/WebcamFeed'
import YoloDetector from './components/YoloDetector'

export default function App() {
  const videoRef = useRef(null)
  // Timer state (seconds). Start at 0 (not counting). When a person is seen we reset to 30 minutes.
  const [timerSeconds, setTimerSeconds] = useState(0)
  const timerStartedRef = useRef(false)

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

  const formatTime = secs => {
    const total = secs > 0 ? secs : 30 * 60
    const m = Math.floor(total / 60).toString().padStart(2, '0')
    const s = Math.floor(total % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // callback from detector about person presence
  // Start timer only once, when the first person is detected.
  const handlePersonPresent = present => {
    if (present && !timerStartedRef.current) {
      timerStartedRef.current = true
      setTimerSeconds(30 * 60) // 30 minutes
    }
  }

  return (
    <div className="app">
      <header className="header">
      </header>

      <main className="main">
        <section className="preview">
          <div>
            <WebcamFeed forwardedRef={videoRef} showVideo={false} autoStart={true} />
            <YoloDetector videoRef={videoRef} enabled={true} onPersonPresent={handlePersonPresent} />
          </div>
          <div style={{position:'absolute',left:0,right:0,top:0,bottom:0,display:'flex',justifyContent:'center',alignItems:'center',pointerEvents:'none'}}>
            <div style={{background:'rgba(0,0,0,0)',color:'#fff',padding:'20px 36px',borderRadius:8,fontSize:'60vh',fontWeight:700,fontFamily:'monospace'}}>
              {formatTime(timerSeconds)}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

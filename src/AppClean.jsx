import React, { useState, useRef, useEffect } from 'react'
import WebcamFeed from './components/WebcamFeed'
import YoloDetector from './components/YoloDetector'

export default function App() {
  const videoRef = useRef(null)
  // Timer state (seconds). Start at 0 (not counting). When a person is seen we reset to 30 minutes.
  const [timerSeconds, setTimerSeconds] = useState(0)
  const timerStartedRef = useRef(false)
  const START_SECONDS = 30 * 60

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
            <div style={{textAlign:'center',width:'100%'}}>
              <div style={{marginBottom:16}}>
                <div style={{color:'#fff',fontSize:28,fontWeight:700}}>Work time!</div>
              </div>
              <div style={{background:'rgba(0,0,0,0)',color:'#fff',padding:'12px 24px',borderRadius:8,fontSize:'48vh',fontWeight:700,fontFamily:'monospace'}}>
                {formatTime(timerSeconds)}
              </div>

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

import React, { useRef, useState } from 'react'

export default function WebcamFeed() {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)
  const [active, setActive] = useState(false)

  const start = async () => {
    setError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      if (videoRef.current) {
        videoRef.current.srcObject = s
        videoRef.current.muted = true
        videoRef.current.playsInline = true
        await videoRef.current.play()
        setActive(true)
      }
    } catch (err) {
      console.error(err)
      setError(err?.message || 'Could not start camera')
    }
  }

  const stop = () => {
    const el = videoRef.current
    if (el && el.srcObject) {
      const s = el.srcObject
      const tracks = s.getTracks()
      tracks.forEach(t => t.stop())
      el.srcObject = null
    }
    setActive(false)
  }

  return (
    <div style={{textAlign:'center'}}>
      {error && <div style={{color:'salmon'}}>{error}</div>}
      <div style={{margin:'12px 0'}}>
        <button onClick={start} disabled={active} style={{marginRight:8}}>Start Camera</button>
        <button onClick={stop} disabled={!active}>Stop Camera</button>
      </div>
      <div>
        <video ref={videoRef} style={{width:'640px',height:'360px',background:'#000'}} />
      </div>
    </div>
  )
}
import React, { useRef, useState } from 'react'

export default function WebcamFeed({ forwardedRef, showVideo = false, autoStart = true }) {
  const internalRef = useRef(null)
  // Use the provided ref object if given, otherwise use internal ref
  const videoRef = forwardedRef ? forwardedRef : internalRef
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

  // auto start camera when requested
  React.useEffect(() => {
    if (autoStart) start()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  // Keep the video element in the DOM but visually hidden when showVideo is false.
  // This preserves the MediaStream for capture while not showing it to the user.
  const videoStyle = showVideo
    ? { width: '640px', height: '360px', background: '#000' }
    : { width: 1, height: 1, opacity: 0, position: 'absolute', left: -9999 }

  return (
    <div style={{textAlign: 'center'}}>
      {/* Camera runs automatically (hidden by default) and is not controllable from the UI */}
      <div>
        <video ref={videoRef} style={videoStyle} />
      </div>
    </div>
  )
}
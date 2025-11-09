import React, { useEffect, useRef, useState } from 'react'

// Server-based YOLO detector. Captures frames from the provided video element and POSTs them
// to the local Flask server at http://localhost:6767/predict. The server returns decoded
// detections (class_id, score, bbox) and this component draws them on an overlay canvas.

export default function YoloDetector({ videoRef, enabled }) {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const overlayRef = useRef(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    if (!enabled) return
    let mounted = true
    setStatus('running (server)')

    const sendFrame = async () => {
      try {
        const v = videoRef?.current
        if (!v || v.readyState < 2) return

        // draw current frame to a temporary canvas at desired size
        const imgSize = 640 // keep consistent with server/img_size
        const c = document.createElement('canvas')
        c.width = imgSize
        c.height = imgSize
        const ctx = c.getContext('2d')
        // draw the video scaled to square imgSize
        ctx.drawImage(v, 0, 0, imgSize, imgSize)

        // convert to blob (jpeg) and send
        const blob = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.8))
        if (!blob) return
        const form = new FormData()
        form.append('image', blob, 'frame.jpg')

        const resp = await fetch('http://localhost:6767/predict?img_size=' + imgSize, {
          method: 'POST',
          body: form
        })
        if (!resp.ok) {
          const t = await resp.text()
          throw new Error('server error: ' + resp.status + ' ' + t)
        }
        const j = await resp.json()
        if (!mounted) return
        if (j.error) {
          throw new Error(j.detail || j.error)
        }

        // Draw detections if present
        if (overlayRef.current) {
          const ctx2 = overlayRef.current.getContext('2d')
          overlayRef.current.width = v.videoWidth || imgSize
          overlayRef.current.height = v.videoHeight || imgSize
          ctx2.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
          const scaleX = overlayRef.current.width / imgSize
          const scaleY = overlayRef.current.height / imgSize
          const dets = j.detections || []
          ctx2.lineWidth = 2
          ctx2.font = '16px sans-serif'
          dets.forEach(d => {
            const [x1, y1, x2, y2] = d.bbox
            const sx1 = x1 * scaleX
            const sy1 = y1 * scaleY
            const sx2 = x2 * scaleX
            const sy2 = y2 * scaleY
            ctx2.strokeStyle = 'lime'
            ctx2.fillStyle = 'lime'
            ctx2.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1)
            const label = `${d.class_id} ${(d.score * 100).toFixed(1)}%`
            ctx2.fillText(label, sx1 + 4, Math.max(16, sy1 + 16))
          })
        }
      } catch (err) {
        console.error('server detect error', err)
        setError(err?.message || String(err))
        setStatus('error')
        // stop polling if fatal
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    }

    // Poll at ~4 FPS
    intervalRef.current = setInterval(sendFrame, 250)

    return () => {
      mounted = false
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [enabled, videoRef])

  return (
    <div style={{marginTop:12}}>
      <div style={{fontSize:13,color:'#94a3b8'}}>Detector status: {status}</div>
      {error && <div style={{color:'salmon'}}>{error}</div>}
      <canvas ref={overlayRef} style={{border:'1px solid rgba(255,255,255,0.06)',marginTop:8,maxWidth:480}} />
      <div style={{color:'#94a3b8',fontSize:12,marginTop:6}}>Server inference mode (POST /predict)</div>
    </div>
  )
}

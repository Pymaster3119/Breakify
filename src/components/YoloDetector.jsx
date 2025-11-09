import React, { useEffect, useRef, useState } from 'react'

// Server-based YOLO detector. Captures frames from the provided video element and POSTs them
// to the local Flask server at http://localhost:6767/predict. The server returns decoded
// detections (class_id, score, bbox) and this component draws them on an overlay canvas.

export default function YoloDetector({ videoRef, enabled, onPersonPresent, onPhoneSeen }) {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const overlayRef = useRef(null)
  const intervalRef = useRef(null)
  const phonePrevRef = useRef(false)
  // alarm refs
  const alarmActiveRef = useRef(false)
  const audioCtxRef = useRef(null)
  const oscRef = useRef(null)
  const gainRef = useRef(null)
  const alarmPulseRef = useRef(null)
  // prevent overlapping uploads: only one in-flight POST at a time
  const sendingRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let mounted = true
    setStatus('running (server)')

    const sendFrame = async () => {
      // throttle: if a request is already in-flight, skip this frame
      if (sendingRef.current) return
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

        sendingRef.current = true
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

        // process detections
        const dets = (j && j.detections) ? j.detections : []

        // If any detection is class 67 or 68 (phone classes), trigger alarm
        const phonePresent = dets.some(d => {
          const id = Number(d.class_id)
          const score = Number(d.score || 0)
          return ((id === 67 || id === 68) && score > 0.5)
        })
        const humanNotPresent = dets.every(d => {
          const id = Number(d.class_id)
          const score = Number(d.score || 0)
          return !(id === 0 && score > 0.5)
        })
        if (phonePresent || humanNotPresent) startAlarm()
        else stopAlarm()

        // rising-edge phone detection: notify parent once per pick-up
        try {
          if (typeof onPhoneSeen === 'function') {
            const prev = phonePrevRef.current || false
            if (phonePresent && !prev) onPhoneSeen()
            phonePrevRef.current = !!phonePresent
          }
        } catch (e) {}

        // Person detection (class 0)
        const personPresent = dets.some(d => {
          const id = Number(d.class_id)
          const score = Number(d.score || 0)
          return id === 0 && score > 0.35
        })
        // notify parent about person presence (if callback provided)
        try { if (typeof onPersonPresent === 'function') onPersonPresent(!!personPresent) } catch (e) {}

        // Draw detections if overlay canvas exists (kept hidden in UI but available for debug)
        if (overlayRef.current) {
          const ctx2 = overlayRef.current.getContext('2d')
          overlayRef.current.width = v.videoWidth || imgSize
          overlayRef.current.height = v.videoHeight || imgSize
          ctx2.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
          const scaleX = overlayRef.current.width / imgSize
          const scaleY = overlayRef.current.height / imgSize
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
      } finally {
        sendingRef.current = false
      }
    }

    // Poll at ~5 FPS (one image every 200ms) but avoid overlapping requests
    intervalRef.current = setInterval(sendFrame, 200)

    return () => {
      mounted = false
      if (intervalRef.current) clearInterval(intervalRef.current)
      // ensure alarm is stopped when component unmounts
      stopAlarm()
    }
  }, [enabled, videoRef])

  // Start a more standard pulsed alarm tone using WebAudio (two square oscillators + gated gain)
  function startAlarm() {
    if (alarmActiveRef.current) return
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      const ac = audioCtxRef.current || new AudioCtx()
      audioCtxRef.current = ac

      // resume if suspended (autoplay policies)
      if (ac.state === 'suspended' && typeof ac.resume === 'function') {
        ac.resume().catch(() => {})
      }

      // Create two square oscillators to create a richer, harsher alarm tone
      const oscA = ac.createOscillator()
      const oscB = ac.createOscillator()
      const gain = ac.createGain()
      oscA.type = 'square'
      oscB.type = 'square'
      oscA.frequency.value = 1000
      oscB.frequency.value = 1400
      gain.gain.value = 0.0

      oscA.connect(gain)
      oscB.connect(gain)
      gain.connect(ac.destination)

      oscA.start()
      oscB.start()

      // Pulse the gain to create a beeping alarm: 400ms on, 300ms off pattern
      let on = false
      const pulseOn = () => {
        if (!gain) return
        try {
          const now = ac.currentTime
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.12, now + 0.02)
        } catch (e) {}
        on = true
      }
      const pulseOff = () => {
        if (!gain) return
        try {
          const now = ac.currentTime
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(gain.gain.value || 0.12, now)
          gain.gain.linearRampToValueAtTime(0, now + 0.05)
        } catch (e) {}
        on = false
      }

      // Start initial pulse immediately
      pulseOn()
      // schedule repeating pulse: on for 400ms, off for 300ms
      alarmPulseRef.current = setInterval(() => {
        if (on) pulseOff()
        else pulseOn()
      }, 400)

      // store refs
      oscRef.current = [oscA, oscB]
      gainRef.current = gain
      alarmActiveRef.current = true
    } catch (e) {
      console.warn('alarm start failed', e)
    }
  }

  function stopAlarm() {
    try {
      if (alarmPulseRef.current) {
        clearInterval(alarmPulseRef.current)
        alarmPulseRef.current = null
      }
      if (oscRef.current) {
        // stop both oscillators
        try {
          oscRef.current.forEach(o => { try { o.stop() } catch (e) {} })
        } catch (e) {}
        try { oscRef.current.forEach(o => { try { o.disconnect() } catch (e) {} }) } catch (e) {}
        oscRef.current = null
      }
      if (gainRef.current) {
        try { gainRef.current.disconnect() } catch (e) {}
        gainRef.current = null
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close() } catch (e) {}
        audioCtxRef.current = null
      }
      alarmActiveRef.current = false
    } catch (e) {
      console.warn('alarm stop failed', e)
    }
  }

  return (
    <div style={{marginTop:12}}>
      {/* overlay is kept in DOM for drawing but hidden from view to avoid showing predictions */}
      <canvas ref={overlayRef} style={{display:'none'}} />
    </div>
  )
}

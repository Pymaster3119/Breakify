import React, { useEffect, useRef, useState } from 'react'
import * as tf from '@tensorflow/tfjs'

// Client-side YOLO v12n detector using TensorFlow.js. Captures frames from the provided video
// element and runs local inference (no backend calls). Keeps the legacy overlay canvas for
// debugging while keeping it hidden in the UI.

const MODEL_URL = import.meta.env.VITE_YOLO12N_MODEL_URL || '/models/yolo12n/model.json'
const INPUT_SIZE = 640
const SCORE_THRESHOLD = 0.35
const NMS_IOU_THRESHOLD = 0.45
const MAX_DETECTIONS = 10
// Limit how often we run inference; default 1000ms for low resource usage
const RATE_LIMIT_MS = 1000
// Choose backend via env (webgl|wasm|cpu). Default to webgl low-power.
const TF_BACKEND = (import.meta.env.VITE_TF_BACKEND || 'webgl').toLowerCase()

export default function YoloDetector({ videoRef, enabled, onPersonPresent, onPhoneSeen, onDistracted }) {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const overlayRef = useRef(null)
  const phonePrevRef = useRef(false)
  const rafRef = useRef(null)
  const timerRef = useRef(null)
  const processingRef = useRef(false)
  const modelRef = useRef(null)
  const lastDetectTsRef = useRef(0)
  // alarm refs
  const alarmActiveRef = useRef(false)
  const audioCtxRef = useRef(null)
  const oscRef = useRef(null)
  const gainRef = useRef(null)
  const alarmPulseRef = useRef(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const loadModel = async () => {
      try {
        setStatus('loading model')
        setError(null)
        await tf.ready()
        if (!tf.getBackend()) {
          // Configure low-power WebGL context when using GPU
          if (TF_BACKEND === 'webgl') {
            try {
              tf.env().set('WEBGL_CONTEXT_ATTRIBUTES', {
                powerPreference: 'low-power',
                alpha: false,
                antialias: false,
                preserveDrawingBuffer: false,
                desynchronized: true
              })
              // Prefer fp16 textures and packing to reduce memory bandwidth
              tf.env().set('WEBGL_FORCE_F16_TEXTURES', true)
              tf.env().set('WEBGL_PACK', true)
            } catch {}
          }
          await tf.setBackend(TF_BACKEND)
          await tf.ready()
        }
        const model = await tf.loadGraphModel(MODEL_URL)
        modelRef.current = model

        // warmup with a single dummy tensor to pay the compile cost upfront
        const warm = tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3], 'float32')
        await model.executeAsync(warm)
        warm.dispose()
        if (cancelled) return
        setStatus('running (tfjs local)')
      } catch (err) {
        console.error('tfjs model load error', err)
        if (!cancelled) {
          setError(err?.message || String(err))
          setStatus('error')
        }
      }
    }

    loadModel()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      stopAlarm()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      stopAlarm()
      setStatus('idle')
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    let stopped = false

    const scheduleNext = () => {
      if (stopped) return
      timerRef.current = setTimeout(async () => {
        if (stopped) return
        await detectOnce()
        scheduleNext()
      }, RATE_LIMIT_MS)
    }

    scheduleNext()

    return () => {
      stopped = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [enabled])

  const detectOnce = async () => {
    if (!enabled) return
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - (lastDetectTsRef.current || 0) < RATE_LIMIT_MS) return
    if (processingRef.current) return
    console.log('Running detection pass at ' + now);
    const model = modelRef.current
    const v = videoRef?.current
    if (!model || !v || v.readyState < 2) return
    processingRef.current = true
    lastDetectTsRef.current = now

    try {
      const dets = await runModel(model, v)

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
      const distracted = !!(phonePresent || humanNotPresent)
      if (distracted) startAlarm()
      else stopAlarm()

      // rising-edge phone detection: notify parent once per pick-up
      try {
        if (typeof onPhoneSeen === 'function') {
          const prev = phonePrevRef.current || false
          if ((phonePresent || humanNotPresent) && !prev) onPhoneSeen()
          phonePrevRef.current = !!phonePresent
        }
      } catch (e) {}

      // report distracted state (every detection pass)
      try {
        if (typeof onDistracted === 'function') onDistracted(distracted)
      } catch (e) {}

      // Person detection (class 0)
      const personPresent = dets.some(d => {
        const id = Number(d.class_id)
        const score = Number(d.score || 0)
        return id === 0 && score > SCORE_THRESHOLD
      })
      // notify parent about person presence (if callback provided)
      try { if (typeof onPersonPresent === 'function') onPersonPresent(!!personPresent) } catch (e) {}

      drawDetections(dets, v)
    } catch (err) {
      console.error('local detect error', err)
      setError(err?.message || String(err))
      setStatus('error')
    } finally {
      processingRef.current = false
    }
  }

  const runModel = async (model, videoEl) => {
    const input = tf.tidy(() => {
      const frame = tf.browser.fromPixels(videoEl)
      const resized = tf.image.resizeBilinear(frame, [INPUT_SIZE, INPUT_SIZE])
      const normalized = resized.div(255)
      const batched = normalized.expandDims(0)
      return batched
    })

    // executeAsync returns Tensor|Tensor[] depending on export; normalize afterwards
    const raw = await model.executeAsync(input)
    input.dispose()

    const { boxesTensor, scoresTensor, disposables } = normalizeOutputs(raw)

    // convert to arrays for post-processing
    const [boxesArr, scoresArr, classesArr] = await Promise.all([
      boxesTensor.array(),
      scoresTensor.max(2).array(),
      scoresTensor.argMax(2).array()
    ])

    const boxes = boxesArr[0]
    const scores = scoresArr[0]
    const classes = classesArr[0]

    const scaleX = (videoEl.videoWidth || INPUT_SIZE) / INPUT_SIZE
    const scaleY = (videoEl.videoHeight || INPUT_SIZE) / INPUT_SIZE

    // Convert (cx, cy, w, h) -> (x1, y1, x2, y2) in pixel space
    const xyxy = boxes.map(b => {
      const [cx, cy, w, h] = b
      const x1 = (cx - w / 2) * scaleX
      const y1 = (cy - h / 2) * scaleY
      const x2 = (cx + w / 2) * scaleX
      const y2 = (cy + h / 2) * scaleY
      return [x1, y1, x2, y2]
    })

    // run NMS on CPU tensors
    const boxesForNms = tf.tensor2d(xyxy.map(b => [b[1], b[0], b[3], b[2]]))
    const scores1d = tf.tensor1d(scores)
    const nmsIdx = await tf.image.nonMaxSuppressionAsync(
      boxesForNms,
      scores1d,
      MAX_DETECTIONS,
      NMS_IOU_THRESHOLD,
      SCORE_THRESHOLD
    )
    const keep = await nmsIdx.array()

    boxesForNms.dispose()
    scores1d.dispose()
    nmsIdx.dispose()
    boxesTensor.dispose()
    scoresTensor.dispose()
    disposables.forEach(t => t.dispose())
    if (Array.isArray(raw)) raw.forEach(t => t.dispose())
    else raw.dispose()

    const dets = keep
      .map(i => ({
        bbox: xyxy[i],
        score: scores[i],
        class_id: classes[i]
      }))
      .filter(d => d.score >= SCORE_THRESHOLD)

    return dets
  }

  const normalizeOutputs = raw => {
    const disposables = []
    // handle multiple output signatures
    if (Array.isArray(raw)) {
      if (raw.length >= 2) {
        return { boxesTensor: raw[0], scoresTensor: raw[1], disposables }
      }
      if (raw.length === 1) {
        raw = raw[0]
      }
    }

    // Expect shape [1, channels, num_boxes] e.g., [1,84,8400]
    const transposed = raw.transpose([0, 2, 1]) // [1, num_boxes, channels]
    disposables.push(transposed)
    const numBoxes = transposed.shape[1]
    const channels = transposed.shape[2]
    const boxesTensor = transposed.slice([0, 0, 0], [1, numBoxes, 4])
    const scoresTensor = transposed.slice([0, 0, 4], [1, numBoxes, channels - 4])
    return { boxesTensor, scoresTensor, disposables }
  }

  const drawDetections = (dets, videoEl) => {
    if (!overlayRef.current) return
    const c = overlayRef.current
    const ctx = c.getContext('2d')
    c.width = videoEl.videoWidth || INPUT_SIZE
    c.height = videoEl.videoHeight || INPUT_SIZE
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.lineWidth = 2
    ctx.font = '16px sans-serif'
    ctx.strokeStyle = 'lime'
    ctx.fillStyle = 'lime'

    dets.forEach(d => {
      const [x1, y1, x2, y2] = d.bbox
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
      const label = `${d.class_id} ${(d.score * 100).toFixed(1)}%`
      ctx.fillText(label, x1 + 4, Math.max(16, y1 + 16))
    })
  }

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

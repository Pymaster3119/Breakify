import React, { useState, useRef } from 'react'
import WebcamFeed from './components/WebcamFeed'
import YoloDetector from './components/YoloDetector'

export default function App() {
  const [showWebcam, setShowWebcam] = useState(false)
  const [detectorOn, setDetectorOn] = useState(false)
  const videoRef = useRef(null)

  return (
    <div className="app">
      <header className="header">
      </header>

      <main className="main">
        <div className="controls">
          <button onClick={() => setShowWebcam(s => !s)}>
            {showWebcam ? 'Stop Webcam' : 'Start Webcam'}
          </button>
        </div>

        <section className="preview">
          {showWebcam ? (
            <div>
              <WebcamFeed forwardedRef={videoRef} />
              <div style={{marginTop:10}}>
                <button onClick={() => setDetectorOn(d => !d)}>{detectorOn ? 'Stop Detector' : 'Start YOLOv11n Detector'}</button>
              </div>
              {detectorOn && <YoloDetector videoRef={videoRef} enabled={detectorOn} />}
            </div>
          ) : (
            <div className="placeholder">Click "Start Webcam" to begin</div>
          )}
        </section>
      </main>
    </div>
  )
}

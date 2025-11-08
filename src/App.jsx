import React, { useState } from 'react'
import WebcamFeed from './components/WebcamFeed'

export default function App() {
  const [showWebcam, setShowWebcam] = useState(false)

  return (
    <div className="app">

      <main className="main">
        <div className="controls">
          <button onClick={() => setShowWebcam(s => !s)}>
            {showWebcam ? 'Stop Webcam' : 'Start Webcam'}
          </button>
        </div>

        <section className="preview">
          {showWebcam ? (
            <WebcamFeed />
          ) : (
            <div className="placeholder">Click "Start Webcam" to begin</div>
          )}
        </section>
      </main>

      <footer className="footer">Built for local inference demo — Auth0 and model integration next.</footer>
    </div>
  )
}

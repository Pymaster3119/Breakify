import React, { useState, useRef } from 'react'
import WebcamFeed from './components/WebcamFeed'
import YoloDetector from './components/YoloDetector'

export default function App() {
  const videoRef = useRef(null)

  return (
    <div className="app">
      <header className="header">
      </header>

      <main className="main">
        <section className="preview">
          <div>
            <WebcamFeed forwardedRef={videoRef} showVideo={false} autoStart={true} />
            <YoloDetector videoRef={videoRef} enabled={true} />
          </div>
        </section>
      </main>
    </div>
  )
}

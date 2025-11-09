import React, { useState } from 'react'

export default function Settings({ workMinutes, breakMinutes, onSave, onClose }) {
  const [work, setWork] = useState(String(workMinutes ?? 30))
  const [brk, setBrk] = useState(String(breakMinutes ?? 10))

  const save = () => {
    const w = Math.max(1, parseInt(work || '0', 10) || 1)
    const b = Math.max(1, parseInt(brk || '0', 10) || 1)
    onSave({ workMinutes: w, breakMinutes: b })
  }

  return (
    <div style={{maxWidth:480, margin:'40px auto', background:'#252424ff', borderRadius:12, padding:20}}>
      <h3 style={{marginTop:0}}>Settings</h3>

      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <label>
          Work length (minutes)
          <input type="number" min="1" value={work} onChange={e => setWork(e.target.value)} style={{width:120,marginLeft:12}} />
        </label>

        <label>
          Break length (minutes)
          <input type="number" min="1" value={brk} onChange={e => setBrk(e.target.value)} style={{width:120,marginLeft:12}} />
        </label>

        <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:8}}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

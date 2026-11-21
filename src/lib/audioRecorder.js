// Records a voice note and returns 16 kHz mono WAV (works the same on iPhone Safari, Android
// and desktop, whatever container the browser records in).

export function canRecord() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== 'undefined'
}

function pickMime() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac']
  return options.find((m) => window.MediaRecorder.isTypeSupported?.(m)) || ''
}

export async function startRecording({ onLevel } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
  const mimeType = pickMime()
  const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks = []
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }

  // Live input level for the waveform animation.
  let raf = 0
  let ctx = null
  if (onLevel) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += ((v - 128) / 128) ** 2
        onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4))
        raf = requestAnimationFrame(tick)
      }
      tick()
    } catch { /* level meter is optional */ }
  }

  recorder.start(250)
  const startedAt = Date.now()

  const cleanup = () => {
    cancelAnimationFrame(raf)
    ctx?.close?.().catch(() => {})
    stream.getTracks().forEach((t) => t.stop())
  }

  return {
    startedAt,
    /** @returns {Promise<{ base64: string, mediaType: string, seconds: number }>} */
    stop: () => new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        cleanup()
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
          const wav = await toWav16k(blob)
          resolve({ base64: await blobToBase64(wav), mediaType: 'audio/wav', seconds: (Date.now() - startedAt) / 1000 })
        } catch (e) {
          // Decoding failed (very old browser): send the original recording.
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
            resolve({ base64: await blobToBase64(blob), mediaType: blob.type.split(';')[0], seconds: (Date.now() - startedAt) / 1000 })
          } catch {
            reject(e)
          }
        }
      }
      recorder.stop()
    }),
    cancel: () => {
      recorder.onstop = cleanup
      try { recorder.stop() } catch { cleanup() }
    },
  }
}

async function toWav16k(blob) {
  const arrayBuf = await blob.arrayBuffer()
  const AC = window.AudioContext || window.webkitAudioContext
  const ctx = new AC()
  const decoded = await new Promise((res, rej) => ctx.decodeAudioData(arrayBuf.slice(0), res, rej))
  ctx.close?.()
  const rate = 16000
  const length = Math.max(1, Math.ceil(decoded.duration * rate))
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext
  const off = new OAC(1, length, rate)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start(0)
  const rendered = await off.startRendering()
  return encodeWav(rendered.getChannelData(0), rate)
}

export function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const write = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let o = 44
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([view], { type: 'audio/wav' })
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

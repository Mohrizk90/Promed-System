// Camera capture for compliance papers — mobile-first (rear camera) + desktop webcam.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../../context/LanguageContext'
import Modal from '../ui/Modal'
import { Camera, RefreshCw, X, Check } from '../ui/Icons'

export default function ComplianceScanCapture({ open, onClose, onCapture, disabled }) {
  const { t } = useLanguage()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileInputRef = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
    }
    setReady(false)
  }, [])

  const startStream = useCallback(async () => {
    setError('')
    stopStream()
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('compliance.scan.no_camera_api'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setReady(true)
    } catch (err) {
      setError(err.message || t('compliance.scan.camera_denied'))
    }
  }, [stopStream, t])

  useEffect(() => {
    if (open) startStream()
    else stopStream()
    return () => stopStream()
  }, [open, startStream, stopStream])

  const snap = () => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = new File([blob], `scan-${stamp}.jpg`, { type: 'image/jpeg' })
      onCapture([file])
      onClose()
    }, 'image/jpeg', 0.92)
  }

  const onNativePick = (e) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length) {
      onCapture(files)
      onClose()
    }
    e.target.value = ''
  }

  return (
    <Modal isOpen={open} onClose={onClose} title={t('compliance.scan.title')} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t('compliance.scan.subtitle')}</p>

        {error ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm">
            {error}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="block mt-2 text-rose-700 font-medium hover:underline"
            >
              {t('compliance.scan.use_phone_camera')}
            </button>
          </div>
        ) : (
          <div className="relative bg-black rounded-xl overflow-hidden aspect-[4/3] max-h-[60vh]">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
                <RefreshCw size={20} className="animate-spin me-2" />
                {t('compliance.scan.starting')}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm py-2 px-3">
            <X size={16} className="inline me-1" /> {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-secondary text-sm py-2 px-3"
          >
            <Camera size={16} className="inline me-1" /> {t('compliance.scan.use_phone_camera')}
          </button>
          <button
            type="button"
            disabled={disabled || !ready}
            onClick={snap}
            className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm inline-flex items-center gap-2"
          >
            <Check size={16} /> {t('compliance.scan.capture')}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onNativePick}
        />
      </div>
    </Modal>
  )
}

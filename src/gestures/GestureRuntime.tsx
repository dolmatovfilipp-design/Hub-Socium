import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { bindBuiltinGestureCommands, claimGestureCommand, dispatchGestureCommand } from './arbiter'
import { bindGestureRouter, runBuiltinGestureCommand, syncGestureFocus } from './execute'
import { clearGestureFocus, shellSwipeDisabled } from './focus'
import { loadGesturePrefs, subscribeGesturePrefs } from './prefs'
import {
  getGestureStatusSnapshot,
  getGestureStream,
  gestureCameraWillResume,
  resumeGestureCamera,
  setGestureUiStatus,
  stopGestureCamera,
  subscribeGestureStatus,
  subscribeGestureStream,
  suspendGestureCamera,
} from './session'
import { speakGesture } from './speech'
import type { EngineEvent, EngineState } from './engine'
import type { GesturePrefs } from './types'
import './gestures.css'

function usePrefs() {
  return useSyncExternalStore(subscribeGesturePrefs, loadGesturePrefs, loadGesturePrefs)
}

function useStatus() {
  return useSyncExternalStore(subscribeGestureStatus, getGestureStatusSnapshot, getGestureStatusSnapshot)
}

function PalmMark({ dim }: { dim: boolean }) {
  return (
    <svg
      className={`hub-gesture-palm ${dim ? 'is-dim' : ''}`}
      viewBox="0 0 64 64"
      aria-hidden
    >
      <path
        d="M32 8c2.4 0 4 1.8 4 4.2V28h2.2V14.5c0-2.2 1.7-4 3.9-4s4 1.8 4 4V30h2.1V18.2c0-2.2 1.7-4 4-4s4 1.8 4 4V36c0 10.2-7.4 18-20.2 18S14 46.2 14 36V24.5c0-2.3 1.8-4.2 4-4.2s4 1.9 4 4.2V28h2V12.2C24 9.8 25.6 8 28 8s4 1.8 4 4.2V28h2V12.2C34 9.8 35.6 8 38 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Camera, focus ring, and corner indicator. Mount once inside the authenticated /app shell.
 * Phase 1 keeps owning voice; this only runs gestures.
 */
export function GestureRuntime() {
  const location = useLocation()
  const navigate = useNavigate()
  const prefs = usePrefs()
  const status = useStatus()
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const prefsRef = useRef(prefs)
  const fpsRef = useRef(prefs.fps)
  const fileDialog = useRef(false)
  const streamTick = useSyncExternalStore(subscribeGestureStream, () => (getGestureStream() ? 1 : 0), () => 0)

  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])

  useEffect(() => {
    bindGestureRouter(location.pathname, (to) => {
      if (typeof to === 'number') navigate(to)
      else navigate(to)
    })
  }, [location.pathname, navigate])

  useEffect(() => bindBuiltinGestureCommands(runBuiltinGestureCommand), [])

  useEffect(() => {
    fpsRef.current = prefs.fps
  }, [prefs.fps])

  useEffect(() => {
    if (!prefs.enabled) {
      clearGestureFocus()
      setGestureUiStatus('off')
      stopGestureCamera()
      return
    }
    syncGestureFocus(true)
    const timer = window.setInterval(() => syncGestureFocus(true), 800)
    return () => window.clearInterval(timer)
  }, [prefs.enabled, location.pathname])

  useEffect(() => {
    const stream = getGestureStream()
    const attach = (node: HTMLVideoElement | null) => {
      if (!node) return
      node.srcObject = stream
      if (stream) void node.play().catch(() => {})
    }
    attach(videoRef.current)
    attach(previewRef.current)
  }, [streamTick, prefs.preview, prefs.enabled])

  useEffect(() => {
    const mark = (event: Event) => {
      const target = event.target
      if (target instanceof HTMLInputElement && target.type === 'file') fileDialog.current = true
    }
    const clear = () => {
      fileDialog.current = false
    }
    document.addEventListener('pointerdown', mark, true)
    window.addEventListener('focus', clear)
    return () => {
      document.removeEventListener('pointerdown', mark, true)
      window.removeEventListener('focus', clear)
    }
  }, [])

  useEffect(() => {
    if (!prefs.enabled) return
    const callOpen = () => Boolean(document.querySelector('[data-video-call]'))
    const apply = () => {
      if (callOpen()) {
        suspendGestureCamera()
        setGestureUiStatus('call', 'Жесты остановлены: камера занята звонком')
        return
      }
      if (document.hidden && prefsRef.current.pauseInBackground) {
        suspendGestureCamera()
        setGestureUiStatus('background')
        return
      }
      if (!document.hidden && gestureCameraWillResume() && !getGestureStream()) {
        void resumeGestureCamera()
      }
    }
    document.addEventListener('visibilitychange', apply)
    const root = document.querySelector('.hub-app-root')
    const observer = new MutationObserver(apply)
    if (root) {
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-video-call'],
      })
    }
    apply()
    return () => {
      document.removeEventListener('visibilitychange', apply)
      observer.disconnect()
    }
  }, [prefs.enabled, prefs.pauseInBackground])

  useEffect(() => {
    if (!prefs.enabled || !getGestureStream()) {
      if (prefs.enabled && !document.querySelector('[data-video-call]')) {
        const current = getGestureStatusSnapshot().status
        if (current !== 'error' && current !== 'background' && current !== 'call') {
          setGestureUiStatus('need-camera', 'Нужно разрешение камеры')
        }
      }
      return
    }
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    let stopLoop = () => {}
    setGestureUiStatus('loading')
    void import('./tracker').then(async ({ startHandLoop }) => {
      if (cancelled) return
      const handle = await startHandLoop(video, {
        getPrefs: () => prefsRef.current,
        getFps: () => fpsRef.current,
        setFps: (fps) => {
          fpsRef.current = fps as GesturePrefs['fps']
        },
        isRecording: () => Boolean(document.querySelector('[data-voice-recording]')),
        isFileDialog: () => fileDialog.current,
        isHidden: () => document.hidden,
        onReady: (engine: EngineState) => {
          if (prefsRef.current.requireActivation && !engine.armed) {
            engine.promptSent = true
            setGestureUiStatus('waiting')
            speakGesture('Подержите открытую ладонь, чтобы включить жесты')
          } else {
            setGestureUiStatus('active')
            speakGesture('Жесты включены')
          }
        },
        onError: (message) => {
          stopGestureCamera()
          setGestureUiStatus('error', message)
          speakGesture(message)
        },
        onPresence: (accepted, armed) => {
          if (!accepted || getGestureStatusSnapshot().status !== 'poor') return
          const next = prefsRef.current.requireActivation && !armed ? 'waiting' : 'active'
          setGestureUiStatus(next)
        },
        onEvents: (events: EngineEvent[]) => {
          for (const event of events) {
            if (event.type === 'speak') speakGesture(event.text)
            if (event.type === 'status') {
              setGestureUiStatus(event.status === 'poor' ? 'poor' : event.status)
            }
            if (event.type === 'command') {
              const stop = event.command === 'stop'
              if (!claimGestureCommand(event.at, stop)) continue
              dispatchGestureCommand(event.command)
            }
          }
        },
      })
      if (cancelled) handle.stop()
      else stopLoop = handle.stop
    })
    return () => {
      cancelled = true
      stopLoop()
    }
  }, [prefs.enabled, streamTick])

  if (!prefs.enabled) return null

  const showCorner = status.status === 'waiting' || status.status === 'active' || status.status === 'paused' || status.status === 'poor'
  const caption =
    status.status === 'waiting'
      ? 'Подержите ладонь'
      : status.status === 'poor'
        ? 'Плохо видно руку'
        : ''
  const accessible =
    status.status === 'waiting'
      ? 'Подержите ладонь'
      : status.status === 'paused'
        ? 'Жесты на паузе'
        : status.status === 'poor'
          ? 'Плохо видно руку'
          : status.status === 'active'
            ? 'Жесты включены'
            : status.detail || 'Управление жестами'

  const indicator = (
    <>
      <video
        ref={videoRef}
        className="hub-gesture-source"
        data-gesture-camera=""
        playsInline
        muted
        autoPlay
      />
      {showCorner ? (
        <div
          className={`hub-gesture-indicator ${shellSwipeDisabled(location.pathname) ? 'is-low' : ''}`}
          role="status"
          aria-live="polite"
          aria-label={accessible}
        >
          {prefs.preview === 'thumbnail' && streamTick ? (
            <video
              ref={previewRef}
              className="hub-gesture-preview"
              data-gesture-camera=""
              playsInline
              muted
              autoPlay
            />
          ) : (
            <PalmMark dim={status.status === 'paused'} />
          )}
          {caption ? <p className="hub-gesture-caption">{caption}</p> : null}
        </div>
      ) : null}
    </>
  )

  const host = document.getElementById('hub-overlay-root')
  if (!host) return indicator
  return createPortal(indicator, host)
}

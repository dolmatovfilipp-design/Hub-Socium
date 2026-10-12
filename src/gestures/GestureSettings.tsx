import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SegmentedControl } from '../components/SegmentedControl'
import { GESTURE_INSTRUCTIONS, GESTURE_LABELS, type InstructionBlock } from './instructions'
import { loadGesturePrefs, saveGesturePrefs, subscribeGesturePrefs } from './prefs'
import {
  getGestureStatusSnapshot,
  getGestureStream,
  requestGestureCamera,
  setGestureUiStatus,
  stopGestureCamera,
  subscribeGestureStatus,
} from './session'
import { speakGesture } from './speech'
import type { GestureId, GesturePrefs } from './types'
import './gestures.css'

const GESTURE_ORDER: GestureId[] = [
  'palm',
  'thumbUp',
  'thumbDown',
  'palmUp',
  'palmDown',
  'palmLeft',
  'palmRight',
  'pinch',
  'fist',
]

function usePrefs(): GesturePrefs {
  return useSyncExternalStore(subscribeGesturePrefs, loadGesturePrefs, loadGesturePrefs)
}

function useStatus() {
  return useSyncExternalStore(subscribeGestureStatus, getGestureStatusSnapshot, getGestureStatusSnapshot)
}

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-[#8e8e93]">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BackChevron() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="-scale-x-100">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`hub-toggle ${checked ? 'is-on' : ''}`}
    >
      <span className="hub-toggle-knob" />
    </button>
  )
}

function InstructionCopy({ block }: { block: InstructionBlock }) {
  const rows = [
    ['Что делает', block.does],
    ['Как включить', block.enable],
    ['Значения и значение по умолчанию', block.values],
    ['Пример', block.example],
    ['Ограничения и безопасность', block.limits],
  ]
  return (
    <div className="space-y-3 pb-1">
      {rows.map(([title, body]) => (
        <div key={title}>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#8e8e93]">{title}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-white/90">{body}</p>
        </div>
      ))}
    </div>
  )
}

function patch(prefs: GesturePrefs, partial: Partial<GesturePrefs>): void {
  saveGesturePrefs({ ...prefs, ...partial })
}

export function GestureInstruction({ anchor }: { anchor?: string | null }) {
  useEffect(() => {
    if (!anchor) return
    document.getElementById(`gesture-help-${anchor}`)?.scrollIntoView({ block: 'start' })
  }, [anchor])

  return (
    <div className="space-y-4 pb-8">
      <p className="px-1 text-[15px] leading-relaxed text-[#8e8e93]">
        Изображение с камеры считается на этом устройстве и не передаётся.
      </p>
      {GESTURE_INSTRUCTIONS.map((block) => (
        <section key={block.id} id={`gesture-help-${block.id}`} className="settings-list-card px-4 py-4">
          <h2 className="mb-3 text-[17px] font-semibold text-white">{block.title}</h2>
          <InstructionCopy block={block} />
        </section>
      ))}
    </div>
  )
}

/** Nested gesture controls. Phase 1 renders this inside «Управление интерфейсом». */
export function GestureSettingsBlock({ onOpenHelp }: { onOpenHelp: (id: string) => void }) {
  const prefs = usePrefs()
  const status = useStatus()
  const [cameraBusy, setCameraBusy] = useState(false)
  const cameraOn = Boolean(getGestureStream())

  const allowCamera = () => {
    if (!prefs.enabled || cameraBusy) return
    setCameraBusy(true)
    void requestGestureCamera().then((result) => {
      setCameraBusy(false)
      if (!result.ok) {
        setGestureUiStatus('error', result.message)
        speakGesture(result.message)
        return
      }
      setGestureUiStatus('loading')
    })
  }

  const statusLine =
    status.detail ||
    (status.status === 'need-camera'
      ? 'Нужно разрешение камеры'
      : status.status === 'waiting'
        ? 'Подержите ладонь'
        : status.status === 'active'
          ? 'Жесты включены'
          : status.status === 'paused'
            ? 'Жесты на паузе'
            : status.status === 'poor'
              ? 'Плохо видно руку'
              : status.status === 'call'
                ? 'Жесты остановлены: камера занята звонком'
                : status.status === 'background'
                  ? 'Камера остановлена в фоне'
                  : status.status === 'loading'
                    ? 'Подготовка распознавания на устройстве'
                    : status.status === 'error'
                      ? 'Не удалось подготовить распознавание жестов'
                      : 'Камера закрыта')

  return (
    <div className="space-y-4 pb-8">
      <p id="gesture-privacy" className="rounded-2xl bg-[#1c1c1e] px-4 py-3 text-[15px] leading-relaxed text-white/90">
        Изображение с камеры считается на этом устройстве и не передаётся.
      </p>

      <div className="settings-list-card px-4">
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="text-[16px] text-white">Управление жестами</p>
            <p className="mt-0.5 text-[13px] leading-snug text-[#8e8e93]">{statusLine}</p>
          </div>
          <Switch
            label="Управление жестами"
            checked={prefs.enabled}
            onChange={(enabled) => {
              patch(prefs, { enabled })
              if (!enabled) {
                stopGestureCamera()
                setGestureUiStatus('off')
              } else if (!getGestureStream()) {
                setGestureUiStatus('need-camera', 'Нужно разрешение камеры')
              }
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-white/10 py-3">
          <button type="button" className="text-[13px] text-[#8e8e93]" onClick={() => onOpenHelp('master')}>
            Инструкция
          </button>
          <button
            type="button"
            className="hub-btn hub-btn-primary shrink-0"
            disabled={!prefs.enabled || cameraBusy || cameraOn}
            onClick={allowCamera}
          >
            {cameraOn ? 'Камера разрешена' : cameraBusy ? 'Запрос…' : 'Разрешить камеру'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="hub-section-title">Чувствительность</p>
          <button type="button" className="text-[13px] text-[#8e8e93]" onClick={() => onOpenHelp('sensitivity')}>
            Инструкция
          </button>
        </div>
        <SegmentedControl
          ariaLabel="Чувствительность жестов"
          value={prefs.sensitivity}
          onChange={(sensitivity) => patch(prefs, { sensitivity })}
          options={[
            { value: 'low', label: 'Низкая' },
            { value: 'medium', label: 'Средняя' },
            { value: 'high', label: 'Высокая' },
          ]}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <p className="hub-section-title">Превью камеры</p>
          <button type="button" className="text-[13px] text-[#8e8e93]" onClick={() => onOpenHelp('preview')}>
            Инструкция
          </button>
        </div>
        <SegmentedControl
          ariaLabel="Превью камеры"
          value={prefs.preview}
          onChange={(preview) => patch(prefs, { preview })}
          options={[
            { value: 'off', label: 'Выключено' },
            { value: 'thumbnail', label: 'Миниатюра' },
          ]}
        />
      </div>

      <div className="settings-list-card px-4">
        <Row
          label="Требовать жест активации"
          extra={
            <Switch
              label="Требовать жест активации"
              checked={prefs.requireActivation}
              onChange={(requireActivation) => patch(prefs, { requireActivation })}
            />
          }
          onHelp={() => onOpenHelp('activation')}
        />
        <div className="border-t border-white/10 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[16px] text-white">Частота кадров</p>
            <button type="button" className="text-[13px] text-[#8e8e93]" onClick={() => onOpenHelp('fps')}>
              Инструкция
            </button>
          </div>
          <SegmentedControl
            ariaLabel="Частота кадров"
            value={String(prefs.fps)}
            onChange={(fps) => patch(prefs, { fps: Number(fps) as GesturePrefs['fps'] })}
            options={[
              { value: '10', label: '10' },
              { value: '15', label: '15' },
              { value: '24', label: '24' },
            ]}
          />
        </div>
        <Row
          label="Останавливать в фоне"
          extra={
            <Switch
              label="Останавливать жесты в фоне"
              checked={prefs.pauseInBackground}
              onChange={(pauseInBackground) => patch(prefs, { pauseInBackground })}
            />
          }
          onHelp={() => onOpenHelp('background')}
          divided
        />
      </div>

      <div>
        <p className="hub-section-title mb-2 px-1">Жесты</p>
        <div className="settings-list-card px-4">
          {GESTURE_ORDER.map((id, index) => (
            <Row
              key={id}
              label={GESTURE_LABELS[id]}
              divided={index > 0}
              extra={
                <Switch
                  label={GESTURE_LABELS[id]}
                  checked={prefs.items[id]}
                  onChange={(checked) => patch(prefs, { items: { ...prefs.items, [id]: checked } })}
                />
              }
              onHelp={() => onOpenHelp(id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  extra,
  onHelp,
  divided = false,
}: {
  label: string
  extra: ReactNode
  onHelp: () => void
  divided?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-3 py-3 ${divided ? 'border-t border-white/10' : ''}`} data-gesture-row="">
      <div className="min-w-0">
        <p className="text-[16px] text-white">{label}</p>
        <button type="button" className="mt-0.5 text-[13px] text-[#8e8e93]" onClick={onHelp}>
          Инструкция
        </button>
      </div>
      {extra}
    </div>
  )
}

function GestureSettingsPage({ onClose }: { onClose: () => void }) {
  const [help, setHelp] = useState<string | null>(null)
  const title = help ? 'Инструкция' : 'Управление жестами'
  const page = (
    <div data-gesture-layer className="pointer-events-auto absolute inset-0 z-[3] flex flex-col bg-black">
      <header className="hub-screen-header relative flex shrink-0 items-center justify-center px-3 pb-2">
        <button
          type="button"
          className="hub-circle-btn absolute left-3"
          aria-label="Назад"
          onClick={() => {
            if (help) setHelp(null)
            else onClose()
          }}
        >
          <BackChevron />
        </button>
        <h1 className="text-[17px] font-bold text-hub-text">{title}</h1>
      </header>
      <div data-gesture-scroll className="no-scrollbar flex-1 overflow-y-auto px-3 scroll-pad-safe">
        {help ? <GestureInstruction anchor={help} /> : <GestureSettingsBlock onOpenHelp={setHelp} />}
      </div>
    </div>
  )
  const host = document.getElementById('hub-overlay-root')
  if (!host) return page
  return createPortal(page, host)
}

/**
 * Standalone settings row used until Phase 1 adds «Управление интерфейсом».
 * After that merge, delete this entry from Settings and render GestureSettingsBlock there.
 */
export function GestureSettingsEntry() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <p className="hub-section-title mb-2 px-1">Управление</p>
      <div className="settings-list-card mb-5">
        <button
          type="button"
          className="settings-list-row relative flex w-full items-center gap-3.5 text-left"
          onClick={() => setOpen(true)}
        >
          <span className="settings-list-label flex-1 text-white">Управление жестами</span>
          <Chevron />
        </button>
      </div>
      {open ? <GestureSettingsPage onClose={() => setOpen(false)} /> : null}
    </>
  )
}

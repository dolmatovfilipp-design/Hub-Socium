import { expect, test } from '@playwright/test'

const shot = (name) => `/opt/cursor/artifacts/${name}.png`

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.MediaRecorder
    let gumCalls = 0

    function iosMime(mime) {
      const m = String(mime || '').toLowerCase()
      return m.startsWith('video/mp4') || m.startsWith('audio/mp4') || m === 'audio/aac'
    }

    class IosRecorder extends EventTarget {
      constructor(stream, opts) {
        super()
        this.stream = stream
        this.mimeType = (opts && opts.mimeType) || 'video/mp4'
        this.state = 'inactive'
        this.ondataavailable = null
        this.onstop = null
        this.onerror = null
        const mime = this.mimeType
        let native = null
        try {
          if (Native && (!opts?.mimeType || Native.isTypeSupported(opts.mimeType))) {
            native = new Native(stream, opts)
          }
        } catch {
          native = null
        }
        this._native = native
        if (native) {
          this.mimeType = native.mimeType || mime
          native.ondataavailable = (ev) => {
            if (this.ondataavailable) this.ondataavailable(ev)
          }
          native.onstop = (ev) => {
            if (this.onstop) this.onstop(ev)
          }
          native.onerror = (ev) => {
            if (this.onerror) this.onerror(ev)
          }
        }
      }

      static isTypeSupported(mime) {
        try {
          if (Native && Native.isTypeSupported(mime)) return true
        } catch {
          /* native probe failed */
        }
        return iosMime(mime)
      }

      start() {
        if (this._native) {
          this._native.start()
          this.state = this._native.state
          return
        }
        this.state = 'recording'
      }

      requestData() {
        try {
          this._native?.requestData()
        } catch {
          /* Safari throws when requestData is unsupported */
        }
      }

      stop() {
        if (this._native) {
          this._native.stop()
          this.state = 'inactive'
          return
        }
        if (this.state !== 'recording') return
        this.state = 'inactive'
        const header = new Uint8Array([
          0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x01,
          0x69, 0x73, 0x6f, 0x6d, 0x61, 0x76, 0x63, 0x31,
        ])
        const blob = new Blob([header, new Uint8Array(48)], { type: this.mimeType.split(';')[0] })
        const data = new Event('dataavailable')
        data.data = blob
        if (this.ondataavailable) this.ondataavailable(data)
        const done = new Event('stop')
        if (this.onstop) this.onstop(done)
      }
    }

    window.MediaRecorder = IosRecorder

    function canvasStream() {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 640
      const ctx = canvas.getContext('2d')
      let frame = 0
      const draw = () => {
        if (!ctx) return
        ctx.fillStyle = frame % 2 === 0 ? '#143d73' : '#0f6b4c'
        ctx.fillRect(0, 0, 640, 640)
        ctx.fillStyle = '#f2f4f7'
        ctx.beginPath()
        ctx.arc(320, 280, 90, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#111'
        ctx.fillRect(250, 250, 18, 18)
        ctx.fillRect(372, 250, 18, 18)
        ctx.fillRect(290, 340, 60, 10)
        frame += 1
        requestAnimationFrame(draw)
      }
      draw()
      canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:64px;height:64px'
      document.documentElement.appendChild(canvas)
      if (!canvas.captureStream) throw new Error('captureStream missing')
      return canvas.captureStream(15)
    }

    function audioTrack() {
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      gain.gain.value = 0.2
      const dest = ctx.createMediaStreamDestination()
      osc.frequency.value = 440
      osc.connect(gain)
      gain.connect(dest)
      osc.start()
      void ctx.resume()
      return dest.stream.getAudioTracks()[0]
    }

    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} })
    }
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      gumCalls += 1
      window.__testGum = gumCalls
      const videoOn = !!constraints?.video
      const stream = videoOn ? canvasStream() : new MediaStream()
      if (videoOn) {
        const track = stream.getVideoTracks()[0]
        let facing = 'user'
        const asked = constraints.video && constraints.video.facingMode
        if (asked === 'environment' || asked === 'user') facing = asked
        const origSettings = track.getSettings.bind(track)
        const origApply = track.applyConstraints.bind(track)
        track.getSettings = () => ({ ...origSettings(), facingMode: facing, width: 640, height: 640 })
        track.applyConstraints = async (next) => {
          const mode = next && next.facingMode
          const value = typeof mode === 'string' ? mode : mode && (mode.exact || mode.ideal)
          if (value === 'user' || value === 'environment') facing = value
          try {
            await origApply(next)
          } catch {
            /* canvas tracks reject camera constraints */
          }
        }
      }
      const mic = audioTrack()
      stream.addTrack(mic)
      return stream
    }
  })
})

test('iPhone circles and voice stay in the composer until send', async ({ page }) => {
  await page.goto('/tests/circle-voice.html')
  await expect(page.locator('[data-mime-ios]')).toHaveText('video/mp4;codecs=avc1.42E01E,mp4a.40.2')
  await expect(page.locator('[data-mime-audio-ios]')).toHaveText('audio/mp4')

  const circle = page.getByRole('button', { name: 'Кружок' })
  await circle.click()
  const live = page.locator('[data-circle-live]')
  await expect(live).toBeVisible()
  await expect(live).toHaveAttribute('data-facing', 'user')
  await expect(page.locator('[data-circle-timer]')).toContainText('0:0')
  await page.screenshot({ path: shot('circle-recorder'), animations: 'disabled' })

  await page.getByRole('button', { name: 'Переключить камеру' }).click()
  await expect(live).toHaveAttribute('data-facing', 'environment')
  await expect(page.locator('[data-gum]')).toHaveText('1')

  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Стоп' }).click()
  const preview = page.locator('[data-circle-preview]')
  await expect(preview).toBeVisible()
  await expect(page.locator('[data-sent-circle]')).toHaveCount(0)
  await expect(page.locator('[data-draft-video]')).toContainText('circle.mp4|video/mp4|')
  await expect(preview.locator('[data-circle-play]')).toHaveAttribute('aria-label', 'Смотреть кружок')
  await expect(preview.locator('[data-circle-time]')).toHaveText(/0:\d\d/)
  await page.screenshot({ path: shot('circle-preview'), animations: 'disabled' })

  await preview.locator('[data-circle-play]').click()
  await preview.getByRole('button', { name: 'Отправить' }).click()
  const sent = page.locator('[data-sent-circle] [data-circle-player]')
  await expect(sent).toBeVisible()
  await expect(page.locator('[data-circle-preview]')).toHaveCount(0)
  await page.screenshot({ path: shot('circle-player'), animations: 'disabled' })

  const box = await sent.boundingBox()
  if (!box) throw new Error('sent circle has no box')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 18)
  const expanded = page.locator('[data-circle-expanded]')
  await expect(expanded).toBeVisible()
  await page.screenshot({ path: shot('circle-expanded'), animations: 'disabled' })

  const scrub = expanded.locator('[data-circle-scrub]')
  const ring = await scrub.boundingBox()
  if (!ring) throw new Error('scrub ring has no box')
  const sx = ring.x + ring.width - 6
  const sy = ring.y + ring.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(ring.x + ring.width / 2, ring.y + 6)
  await page.mouse.up()
  await expect(scrub).not.toHaveAttribute('aria-valuenow', '0')

  await page.mouse.click(8, 8)
  await expect(expanded).toHaveCount(0)

  await page.getByRole('button', { name: 'Голосовое' }).click()
  await expect(page.locator('[data-voice-recording]')).toBeVisible()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Стоп' }).click()
  const voice = page.locator('[data-voice-preview]')
  await expect(voice).toBeVisible()
  await expect(page.locator('[data-draft-audio]')).toContainText('voice.m4a|audio/mp4|')
  await expect(voice.locator('[data-voice-wave]')).toBeVisible()
  await expect(voice.locator('[data-voice-time]')).toHaveText(/0:\d\d/)
  await expect(voice.getByRole('button', { name: 'Удалить' })).toBeVisible()
  await expect(voice.getByRole('button', { name: 'Отправить' })).toBeVisible()
  await page.screenshot({ path: shot('voice-preview'), animations: 'disabled' })

  await voice.locator('[data-voice-play]').click()
  const wave = await voice.locator('[data-voice-wave]').boundingBox()
  if (!wave) throw new Error('waveform has no box')
  await page.mouse.click(wave.x + wave.width * 0.7, wave.y + wave.height / 2)
  await expect(voice.locator('[data-voice-wave]')).not.toHaveAttribute('aria-valuenow', '0')
  await expect(page.locator('[data-gum]')).toHaveText('1')

  await voice.getByRole('button', { name: 'Удалить' }).click()
  await expect(voice).toHaveCount(0)
  await circle.click()
  await expect(page.locator('[data-circle-live]')).toBeVisible()
  await expect(page.locator('[data-gum]')).toHaveText('1')
  await expect(page.locator('[data-toast]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.locator('[data-circle-live]')).toHaveCount(0)
  await expect(page.locator('[data-circle-preview]')).toHaveCount(0)
})

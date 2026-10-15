import { expect, test } from '@playwright/test'

const shot = (name) => `/opt/cursor/artifacts/${name}.png`

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let gumCalls = 0

    function iosMime(mime) {
      const m = String(mime || '').toLowerCase()
      return m.startsWith('video/mp4') || m.startsWith('audio/mp4') || m === 'audio/aac'
    }

    // WebKit here can see a canvas stream, but it cannot record H.264 MP4.
    // Report the iPhone mime list and finish one ftyp blob on stop (no timeslice).
    class IosRecorder extends EventTarget {
      constructor(_stream, opts) {
        super()
        this.mimeType = (opts && opts.mimeType) || 'video/mp4'
        this.state = 'inactive'
        this.ondataavailable = null
        this.onstop = null
        this.onerror = null
      }

      static isTypeSupported(mime) {
        return iosMime(mime)
      }

      start() {
        this.state = 'recording'
      }

      requestData() {}

      stop() {
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
    window.__initOk = true
    const gum = async (constraints) => {
      gumCalls += 1
      window.__testGum = gumCalls
      const videoOn = !!constraints?.video
      const stream = videoOn ? canvasStream() : new MediaStream()
      if (videoOn) {
        let facing = 'user'
        const asked = constraints.video && constraints.video.facingMode
        if (asked === 'environment' || asked === 'user') facing = asked
        const readFacing = (next) => {
          const mode = next && next.facingMode
          const value = typeof mode === 'string' ? mode : mode && (mode.exact || mode.ideal)
          if (value === 'user' || value === 'environment') facing = value
        }
        // WebKit hands out a fresh track wrapper from getVideoTracks(). Patch every wrapper.
        const origVideoTracks = stream.getVideoTracks.bind(stream)
        const patch = (track) => {
          if (!track || track.__hubFacing) return track
          track.__hubFacing = true
          const origSettings = track.getSettings.bind(track)
          track.getSettings = () => ({ ...origSettings(), facingMode: facing, width: 640, height: 640 })
          track.applyConstraints = async (next) => {
            readFacing(next)
          }
          return track
        }
        stream.getVideoTracks = () => origVideoTracks().map(patch)
        stream.getTracks = () => [...stream.getVideoTracks(), ...stream.getAudioTracks()]
        patch(origVideoTracks()[0])
      }
      const mic = audioTrack()
      stream.addTrack(mic)
      return stream
    }
    try {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, writable: true, value: gum })
      window.__gumInstall = 'define'
    } catch (err) {
      try {
        navigator.mediaDevices.getUserMedia = gum
        window.__gumInstall = 'assign'
      } catch (err2) {
        window.__gumInstall = String(err) + ' | ' + String(err2)
      }
    }
  })
})

test('iPhone circles and voice stay in the composer until send', async ({ page }) => {
  await page.goto('/tests/circle-voice.html')
  await expect(page.locator('[data-mime-ios]')).toHaveText('video/mp4;codecs=avc1.42E01E,mp4a.40.2')
  await expect(page.locator('[data-mime-audio-ios]')).toHaveText('audio/mp4')

  const circle = page.getByRole('button', { name: 'Кружок', exact: true })
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
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 40)
  const expanded = page.locator('#hub-overlay-root > div')
  await expect(expanded).toBeVisible()
  await expect(expanded.locator('[data-circle-player]')).toHaveAttribute('data-circle-expanded', 'true')
  await page.screenshot({ path: shot('circle-expanded'), animations: 'disabled' })

  const scrub = expanded.locator('[data-circle-scrub]')
  const ring = await scrub.boundingBox()
  if (!ring) throw new Error('scrub ring has no box')
  const sx = ring.x + ring.width * 0.92
  const sy = ring.y + ring.height / 2
  await scrub.dispatchEvent('pointerdown', { clientX: sx, clientY: sy, pointerId: 1, buttons: 1, bubbles: true })
  await scrub.dispatchEvent('pointerup', { clientX: sx, clientY: sy, pointerId: 1, buttons: 0, bubbles: true })
  await expect(scrub).not.toHaveAttribute('aria-valuenow', '0')

  await expanded.click({ position: { x: 24, y: 24 }, force: true })
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

import { webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'

const base = process.env.STORY_BASE_URL || 'http://127.0.0.1:5174'
const outDir = '/opt/cursor/artifacts'

function installHooks() {
  const seedState = {
    state: {
      currentUserId: 'u-story',
      consent152: true,
      users: [
        {
          id: 'u-story',
          name: 'Аня',
          username: 'anya',
          email: 'anya@hub.app',
          password: 'test',
          bio: '',
          followers: 0,
          following: 0,
        },
      ],
      settings: {
        notificationsLikes: true,
        notificationsFollows: true,
        notificationsMessages: true,
        notificationsMentions: true,
        privacyPrivateAccount: false,
        privacyShowActivity: true,
        privacyAllowMessages: true,
        hideStories: false,
      },
      posts: [],
      conversations: [],
      messages: [],
      followingIds: [],
    },
    version: 0,
  }
  // Playwright's WebKit build has no camera devices and no MediaRecorder.
  // The fake stream is a live canvas capture (and a tiny mp4 recorder) so the
  // app still goes through getUserMedia, the video element, and MediaRecorder.
  window.__hook = 'ran'
  window.__hookMedia = !!navigator.mediaDevices
  const install = () => {
    const media = navigator.mediaDevices
    if (!media) return false
    if (media.__hubWrapped) return true
    let source = null
    const fakeStream = () => {
      if (source) return typeof source.clone === 'function' ? source.clone() : source
      const canvas = document.createElement('canvas')
      canvas.width = 360
      canvas.height = 640
      const ctx = canvas.getContext('2d')
      let frame = 0
      window.setInterval(() => {
        frame += 1
        ctx.fillStyle = frame % 2 ? '#1a2744' : '#243656'
        ctx.fillRect(0, 0, 360, 640)
        ctx.fillStyle = '#ffffff'
        ctx.font = '28px sans-serif'
        ctx.fillText('Камера', 40, 90)
      }, 70)
      source = canvas.captureStream(15)
      return typeof source.clone === 'function' ? source.clone() : source
    }
    if (typeof MediaRecorder === 'undefined') {
      class FakeMediaRecorder {
        constructor(_stream, options) {
          this.mimeType = options?.mimeType || 'video/mp4'
          this.state = 'inactive'
          this.ondataavailable = null
          this.onstop = null
          this.onerror = null
        }
        start() {
          this.state = 'recording'
        }
        stop() {
          if (this.state === 'inactive') return
          this.state = 'inactive'
          const blob = new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' })
          this.ondataavailable?.({ data: blob })
          this.onstop?.()
        }
        static isTypeSupported(type) {
          return String(type).includes('mp4')
        }
      }
      window.MediaRecorder = FakeMediaRecorder
    }
    const wrapped = async (constraints) => {
      window.__gum = (window.__gum || 0) + 1
      window.__gumLast = constraints
      if (window.__gumMode === 'deny') {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }
      return fakeStream()
    }
    const lock = (target) => {
      try {
        Object.defineProperty(target, 'getUserMedia', {
          configurable: true,
          enumerable: true,
          get: () => wrapped,
          set: (value) => {
            window.__gumReset = String(value).slice(0, 60)
          },
        })
      } catch {
        target.getUserMedia = wrapped
      }
    }
    lock(media)
    const proto = Object.getPrototypeOf(media)
    if (proto) lock(proto)
    media.__hubWrapped = true
    return true
  }
  if (!install()) {
    const timer = window.setInterval(() => {
      if (install()) window.clearInterval(timer)
    }, 20)
    window.setTimeout(() => window.clearInterval(timer), 5000)
  }
  localStorage.setItem('hub-app-v3-vitrina', JSON.stringify(seedState))
  localStorage.setItem('hub-consent-v1', '1')
  localStorage.setItem('hub_onboarding_seen_v1', '1')
  localStorage.setItem('hub_follow_nudge_v1', '1')
  localStorage.setItem('hub_a2hs_dismissed', '1')
  localStorage.setItem('hub_use_api', 'false')
  window.__gum = 0
  window.__hookInstall = install()
  window.__hookFn = String(navigator.mediaDevices?.getUserMedia || '').slice(0, 80)
}

async function shot(page, name) {
  await page.screenshot({ path: `${outDir}/${name}.png` })
}

async function openApp(context) {
  const page = await context.newPage()
  page.on('pageerror', (err) => console.log('PAGEERROR', err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLE', msg.text())
  })
  await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Добавить историю' }).waitFor({ timeout: 15000 })
  return page
}

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await webkit.launch()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  await context.addInitScript(installHooks)
  const page = await openApp(context)

  await page.getByRole('button', { name: 'Добавить историю' }).click()
  await page.getByTestId('story-camera').waitFor()
  try {
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-testid="story-preview"]')
      const shutter = document.querySelector('[data-testid="story-shutter"]')
      return video instanceof HTMLVideoElement && video.videoWidth > 0 && shutter instanceof HTMLButtonElement && !shutter.disabled
    }, null, { timeout: 8000 })
  } catch (err) {
    const debug = await page.evaluate(() => {
      const video = document.querySelector('[data-testid="story-preview"]')
      const shutter = document.querySelector('[data-testid="story-shutter"]')
      return {
        gum: window.__gum,
        facing: document.querySelector('[data-testid="story-camera"]')?.getAttribute('data-facing'),
        torch: document.querySelector('[data-testid="story-camera"]')?.getAttribute('data-torch'),
        error: document.querySelector('[data-testid="story-camera-error"]')?.innerText || null,
        hint: document.body.innerText.slice(0, 500),
        video: video ? { w: video.videoWidth, h: video.videoHeight, ready: video.readyState, paused: video.paused, src: !!video.srcObject } : null,
        shutterDisabled: shutter ? shutter.disabled : null,
        mr: typeof MediaRecorder,
        gumFn: String(navigator.mediaDevices?.getUserMedia).slice(0, 120),
        perm: sessionStorage.getItem('hub_story_camera_perm'),
        hook: window.__hook || null,
        hookMedia: window.__hookMedia,
        hookInstall: window.__hookInstall,
        hookFn: window.__hookFn || null,
        gumReset: window.__gumReset || null,
      }
    })
    console.log('CAMERA DEBUG', JSON.stringify(debug, null, 2))
    await shot(page, 'story-camera-debug')
    throw err
  }
  const gumAfterOpen = await page.evaluate(() => window.__gum)
  if (gumAfterOpen < 1) throw new Error(`expected getUserMedia, got ${gumAfterOpen}`)
  await shot(page, 'story-camera')

  await page.getByTestId('story-shutter').click()
  await page.getByTestId('story-editor').waitFor()
  await page.getByTestId('story-media').waitFor()
  await shot(page, 'story-editor')
  if (await page.getByText('Новая история').count()) throw new Error('form sheet is still present')

  await page.getByRole('button', { name: 'Холодный' }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="story-media"]')?.getAttribute('data-filter') === 'cool')
  await page.getByRole('button', { name: 'Текст' }).click()
  await page.getByPlaceholder('Текст').fill('Привет из камеры')
  await page.getByRole('button', { name: 'Плашка' }).click()
  await page.getByRole('button', { name: 'Готово' }).click()
  const text = page.getByTestId('story-text')
  await text.waitFor()
  if ((await text.getAttribute('data-style')) !== 'plate') throw new Error('text style was not applied')
  const box = await text.boundingBox()
  if (!box) throw new Error('text overlay has no box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + 80)
  await page.mouse.up()

  await page.getByRole('button', { name: 'Место' }).click()
  await page.getByPlaceholder('Место').fill('Москва')
  await page.getByRole('button', { name: 'Добавить место' }).click()
  await page.getByTestId('story-place').waitFor()

  await page.getByTestId('story-song-input').setInputFiles({
    name: 'вечер.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('ID3fake'),
  })
  await page.getByTestId('story-song').waitFor()
  await page.getByRole('button', { name: 'Выцветший' }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="story-media"]')?.getAttribute('data-filter') === 'fade')
  await shot(page, 'story-editor-ready')

  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await page.getByText('Истории публикуются при подключении к серверу').waitFor()

  const gumBeforeBack = await page.evaluate(() => window.__gum)
  await page.getByRole('button', { name: 'Назад' }).click()
  await page.getByTestId('story-camera').waitFor()
  await page.waitForFunction(() => {
    const video = document.querySelector('[data-testid="story-preview"]')
    return video instanceof HTMLVideoElement && video.videoWidth > 0
  })
  const gumAfterBack = await page.evaluate(() => window.__gum)
  if (gumAfterBack !== gumBeforeBack) {
    throw new Error(`camera stream was requested again on retake: ${gumBeforeBack} -> ${gumAfterBack}`)
  }

  const shutter = page.getByTestId('story-shutter')
  const shutterBox = await shutter.boundingBox()
  if (!shutterBox) throw new Error('shutter missing')
  const cx = shutterBox.x + shutterBox.width / 2
  const cy = shutterBox.y + shutterBox.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.waitForTimeout(900)
  const recording = await shutter.getAttribute('data-recording')
  const progress = Number(await shutter.getAttribute('data-progress'))
  await shot(page, 'story-recording')
  await page.mouse.up()
  if (recording !== 'true' || !(progress > 0)) {
    throw new Error(`hold did not record (recording=${recording}, progress=${progress})`)
  }
  await page.getByTestId('story-editor').waitFor()
  await page.getByRole('button', { name: 'Назад' }).click()
  await page.getByRole('button', { name: 'Переключить камеру' }).click()
  await page.waitForTimeout(400)
  await page.getByTestId('story-preview').waitFor()

  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByTestId('story-camera').waitFor({ state: 'detached' })
  if (await page.getByText('Новая история').count()) throw new Error('form sheet returned')
  console.log('camera flow ok', { gumAfterOpen, gumAfterBack, progress })
  await context.close()

  const denied = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await denied.addInitScript(installHooks)
  await denied.addInitScript(() => {
    window.__gumMode = 'deny'
  })
  const deniedPage = await openApp(denied)
  await deniedPage.getByRole('button', { name: 'Добавить историю' }).click()
  await deniedPage.getByTestId('story-camera-error').waitFor()
  await deniedPage.getByText('Нет доступа к камере').waitFor()
  await shot(deniedPage, 'story-denied')
  const firstDeny = await deniedPage.evaluate(() => window.__gum)
  await deniedPage.getByRole('button', { name: 'Закрыть' }).click()
  await deniedPage.getByRole('button', { name: 'Добавить историю' }).click()
  await deniedPage.getByTestId('story-camera-error').waitFor()
  const secondDeny = await deniedPage.evaluate(() => window.__gum)
  if (firstDeny !== 1 || secondDeny !== 1) {
    throw new Error(`permission was requested again: ${firstDeny} -> ${secondDeny}`)
  }
  await deniedPage.getByTestId('story-gallery-input').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  })
  await deniedPage.getByTestId('story-editor').waitFor()
  await shot(deniedPage, 'story-gallery-editor')
  console.log('permission reuse ok', { firstDeny, secondDeny })
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

import { webkit } from 'playwright'
import { mkdirSync } from 'node:fs'

const API = 'http://127.0.0.1:8080'
const APP = 'http://127.0.0.1:5174'
const ART = '/opt/cursor/artifacts'
mkdirSync(ART, { recursive: true })

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json, text }
}

function must(res, label) {
  if (res.status >= 400) throw new Error(`${label} ${res.status} ${res.text}`)
  return res.json
}

async function register(username, display) {
  const created = must(
    await api('/v1/auth/register', {
      method: 'POST',
      body: {
        username,
        display_name: display,
        email: `${username}@hold.test`,
        password: 'demo-pass',
      },
    }),
    'register',
  )
  const token = created.access_token
  const code = created.dev_code
  if (!code) throw new Error('register did not return dev_code')
  must(
    await api('/v1/me/email/verify/confirm', {
      method: 'POST',
      token,
      body: { code },
    }),
    'verify confirm',
  )
  must(
    await api('/v1/me/message-prefs', {
      method: 'PUT',
      token,
      body: { message_policy: 'everyone' },
    }),
    'prefs',
  )
  return { token, refresh: created.refresh_token, userId: created.user?.id, display }
}

async function openChat(browser, session, convId) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await context.addInitScript(
    ({ access, refresh }) => {
      localStorage.setItem('hub_use_api', 'true')
      localStorage.setItem('hub_access_token', access)
      localStorage.setItem('hub_refresh_token', refresh)
      localStorage.setItem('hub-consent-v1', '1')
      localStorage.setItem('hub_onboarding_seen_v1', '1')
      localStorage.setItem('hub_follow_nudge_v1', '1')
      localStorage.setItem('hub_a2hs_dismissed', '1')
      localStorage.setItem('hub_push_ask_dismissed', '1')
    },
    { access: session.token, refresh: session.refresh },
  )
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.on('crash', () => console.error('page crashed'))
  page.on('pageerror', (err) => console.error('pageerror', err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('console', msg.text())
  })
  await page.goto(`${APP}/app/messages/${convId}`, { waitUntil: 'domcontentloaded' })
  try {
    await page.getByTestId('msg-bubble').first().waitFor({ state: 'visible' })
  } catch (err) {
    const url = page.url()
    const text = await page.locator('body').innerText().catch(() => '')
    console.error('open failed', url, text.slice(0, 800))
    await page.screenshot({ path: `${ART}/open-failed.png` }).catch(() => {})
    throw err
  }
  return { context, page }
}

async function hold(page, bubble) {
  await bubble.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + Math.min(24, r.height / 2),
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
      isPrimary: true,
    }
    el.dispatchEvent(new PointerEvent('pointerdown', init))
    window.setTimeout(() => {
      el.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }))
    }, 520)
  })
  try {
    await page.getByTestId('msg-hold-menu').waitFor({ state: 'visible', timeout: 4_000 })
  } catch (err) {
    await page.screenshot({ path: `${ART}/hold-failed.png` }).catch(() => {})
    throw err
  }
}

async function main() {
  const stamp = Date.now().toString(36)
  const alice = await register(`holda${stamp}`, 'Алиса')
  const bob = await register(`holdb${stamp}`, 'Борис')

  const dm = must(
    await api('/v1/conversations', {
      method: 'POST',
      token: alice.token,
      body: { user_id: bob.userId },
    }),
    'dm',
  )
  const group = must(
    await api('/v1/conversations/group', {
      method: 'POST',
      token: alice.token,
      body: { title: 'Круг', member_ids: [bob.userId] },
    }),
    'group',
  )
  must(
    await api(`/v1/conversations/${group.id}/invites/accept`, { method: 'POST', token: bob.token, body: {} }),
    'accept',
  )
  const saved = must(
    await api('/v1/conversations/saved', { method: 'POST', token: alice.token, body: {} }),
    'saved',
  )

  const seed = must(
    await api(`/v1/conversations/${dm.id}/messages`, {
      method: 'POST',
      token: alice.token,
      body: { body: 'Привет из чата', msg_type: 'text' },
    }),
    'seed',
  )
  const voice = must(
    await api(`/v1/conversations/${group.id}/messages`, {
      method: 'POST',
      token: alice.token,
      body: {
        body: 'Голос',
        msg_type: 'voice',
        media_url: 'https://example.com/voice.ogg',
        duration_ms: 1200,
      },
    }),
    'voice',
  )
  const circle = must(
    await api(`/v1/conversations/${group.id}/messages`, {
      method: 'POST',
      token: alice.token,
      body: {
        body: 'Кружок',
        msg_type: 'video_note',
        media_url: 'https://example.com/circle.mp4',
        duration_ms: 2000,
      },
    }),
    'circle',
  )
  const forwarded = must(
    await api(`/v1/conversations/${group.id}/forward`, {
      method: 'POST',
      token: alice.token,
      body: { message_id: voice.id, to_conversation_ids: [group.id, saved.id] },
    }),
    'forward voice',
  )
  assert(forwarded.items?.length === 2, `voice forward items ${JSON.stringify(forwarded)}`)
  for (const item of forwarded.items) {
    assert(item.msg_type === 'voice', 'forwarded voice type')
    assert(item.forwarded_from?.name === 'Алиса', `forwarded_from ${JSON.stringify(item.forwarded_from)}`)
  }
  const circleFwd = must(
    await api(`/v1/conversations/${group.id}/forward`, {
      method: 'POST',
      token: alice.token,
      body: { message_id: circle.id, to_conversation_id: group.id },
    }),
    'forward circle',
  )
  assert(circleFwd.msg_type === 'video_note', 'circle type')
  assert(circleFwd.forwarded_from?.name === 'Алиса', 'circle author')

  const stranger = await api(`/v1/conversations/${dm.id}/messages/${seed.id}`, {
    method: 'DELETE',
    token: bob.token,
  })
  assert(stranger.status === 403, `bob delete ${stranger.status} ${stranger.text}`)

  const browser = await webkit.launch()
  const a = await openChat(browser, alice, dm.id)
  const b = await openChat(browser, bob, dm.id)

  const original = a.page.locator(`[data-testid="msg-bubble"][data-msg-id="${seed.id}"]`)
  const originalOnB = b.page.locator(`[data-testid="msg-bubble"][data-msg-id="${seed.id}"]`)
  await hold(a.page, original)
  for (const id of ['msg-action-reply', 'msg-action-forward', 'msg-action-edit', 'msg-action-copy', 'msg-action-delete']) {
    await a.page.getByTestId(id).waitFor({ state: 'visible' })
  }
  await a.page.screenshot({ path: `${ART}/hold-menu.png` })

  await a.page.getByTestId('msg-action-forward').click()
  await a.page.getByTestId('forward-picker').waitFor({ state: 'visible' })
  await a.page.getByTestId('forward-search').fill('Круг')
  const groupRow = a.page.getByTestId('forward-row').filter({ hasText: 'Круг' })
  await groupRow.waitFor({ state: 'visible' })
  await a.page.screenshot({ path: `${ART}/forward-picker.png` })
  await groupRow.click()
  await a.page.getByTestId('forward-send').click()
  await a.page.getByText('Переслано', { exact: true }).waitFor({ state: 'visible' })

  const groupList = must(
    await api(`/v1/conversations/${group.id}/messages`, { token: bob.token }),
    'group messages',
  )
  const groupCopy = (groupList.items || []).find((m) => m.body === 'Привет из чата' && m.forwarded_from)
  assert(groupCopy?.forwarded_from?.name === 'Алиса', `group copy ${JSON.stringify(groupCopy)}`)

  await hold(a.page, original)
  await a.page.getByTestId('msg-action-reply').click()
  const composer = a.page.getByTestId('composer-quote')
  await composer.waitFor({ state: 'visible' })
  const composerText = await composer.innerText()
  assert(composerText.includes('Привет из чата'), `composer ${composerText}`)
  await a.page.screenshot({ path: `${ART}/reply-composer.png` })
  await a.page.getByPlaceholder('Сообщение').fill('Ответ на привет')
  await a.page.getByRole('button', { name: 'Отправить' }).click()
  const quote = a.page.getByTestId('reply-quote').filter({ hasText: 'Привет из чата' })
  await quote.waitFor({ state: 'visible' })
  await a.page.screenshot({ path: `${ART}/reply-quote.png` })
  await quote.click()

  const replyMsg = a.page.getByTestId('msg-bubble').filter({ hasText: 'Ответ на привет' })
  await hold(a.page, replyMsg)
  await a.page.getByTestId('msg-action-edit').click()
  await a.page.getByTestId('composer-edit').waitFor({ state: 'visible' })
  await a.page.getByPlaceholder('Сообщение').fill('Ответ изменён')
  await a.page.getByRole('button', { name: 'Отправить' }).click()
  await a.page.getByText('изменено').first().waitFor({ state: 'visible' })

  await hold(a.page, original)
  await a.page.getByTestId('msg-action-delete').click()
  await a.page.getByTestId('delete-sheet').waitFor({ state: 'visible' })
  await a.page.getByTestId('delete-for-me').waitFor({ state: 'visible' })
  await a.page.getByTestId('delete-for-everyone').waitFor({ state: 'visible' })
  await a.page.screenshot({ path: `${ART}/delete-sheet.png` })
  await a.page.getByTestId('delete-for-everyone').click()
  await original.waitFor({ state: 'detached' })
  await originalOnB.waitFor({ state: 'detached', timeout: 20_000 })

  await a.context.close()
  await b.context.close()
  await browser.close()
  console.log('ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

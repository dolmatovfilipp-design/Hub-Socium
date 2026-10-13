# Жесты, фаза 3

Модуль сам следит за камерой, считает ландмарки в браузере и вызывает команды.
Кадры, ландмарки и картинка руки на сервер не отправляются и на диск не пишутся.
Модель: `public/models/hand_landmarker.task`. Wasm MediaPipe копируется в `public/mediapipe/wasm` при сборке и в `vite dev`.

Фаза 1 владеет разделом «Управление интерфейсом» и голосовыми командами.
Этот модуль не должен заводить вторую навигацию, если фаза 1 уже зарегистрировала команды.

## Куда вставить

1. В оболочке `/app` (уже после входа и согласия) один раз:

```tsx
import { GestureRuntime } from './gestures'

<GestureRuntime />
```

2. Пока экрана «Управление интерфейсом» нет, в `Settings.tsx` стоит временная строка:

```tsx
import { GestureSettingsEntry } from './gestures'

<GestureSettingsEntry />
```

Когда фаза 1 рисует «Управление интерфейсом», эту строку нужно убрать и вместо неё вложить блок:

```tsx
import { GestureSettingsBlock, GestureInstruction } from './gestures'

<GestureSettingsBlock onOpenHelp={(id) => openInstruction(id)} />
```

Полный текст инструкции по каждому жесту и каждой настройке — `<GestureInstruction />`. Его можно вставить в общий экран «Инструкция» фазы 1 без сокращений.

## Общие команды

Жест не ходит по маршрутам сам, если фаза 1 вернула `true`:

```tsx
import { registerGestureCommands, claimVoiceCommand } from './gestures'

registerGestureCommands((command) => {
  // stop | like | unlike | next | previous | next-tab | prev-tab | open | back
  return runPhase1Command(command)
})
```

Если обработчик не зарегистрирован или вернул не `true`, модуль выполняет то же действие текущими кнопками, фокусом и `navigate`.

Голос и жест в одну секунду: раньше начавшийся побеждает, «стоп» и ладонь прерывают остальное. Время — `performance.now()`.

```tsx
if (!claimVoiceCommand(performance.now(), phraseIsStop)) return
```

Фразы жестов можно отдать в синтез фазы 1:

```tsx
import { registerGestureSpeaker } from './gestures'

registerGestureSpeaker((text) => speakWithVoiceSettings(text))
```

## Хранение

Ключ `localStorage`: `hub-voice-prefs-v1`. Жестам принадлежит только объект `gestures`. Запись сливается с уже лежащим JSON и не стирает ключи голоса. На сервер список не уходит.

## Сигналы страницы

- `data-gesture-item` — элемент фокуса (`post`, `listing`, `switcher`, `clip`)
- `data-post-id` — щипок открывает `/app/p/:id`
- `data-gesture-like` и `data-liked="true|false"` — лайк не снимает отметку
- `data-gesture-open` — явная цель щипка
- `data-gesture-danger` — щипок не нажимает
- `data-voice-recording` — из жестов остаётся только ладонь «стоп»
- `data-video-call` — жесты и вторая камера останавливаются
- событие `hub:gesture-command` с `{ command }` — фаза 2 по `stop` обрывает запись без отправки

Щипок не нажимает «Опубликовать», «Отправить», «Удалить», «Выйти» и «Демо-оплата».
Горизонтальный жест не переключает ленту и маркет и не листает панель там, где оболочка не принимает свайп.

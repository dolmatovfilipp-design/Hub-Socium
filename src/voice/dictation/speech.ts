/** User-facing phrases from the voice-control spec. Phase 2 does not invent extra commands. */

export const SPEECH = {
  dictateReply: 'Диктуйте ответ',
  dictateComment: 'Диктуйте комментарий',
  dictateEdit: 'Диктуйте новый текст',
  dictateHint: 'Диктуйте. Затем скажите готово',
  record: 'Запись. Остановлю после паузы',
  recordReply: 'Запись ответа',
  replyToThis: 'Ответ на это сообщение',
  rerecord: 'Записываю заново',
  recordingDeleted: 'Запись удалена',
  cancelled: 'Отменено',
  stopped: 'Остановила',
  timedOut: 'Отменила',
  tooShort: 'Слишком коротко',
  nothingToSend: 'Нечего отправлять',
  disabled: 'Команда выключена в управлении интерфейсом',
  wrongScreen: 'Эта команда здесь не действует',
  mediaEdit: 'Медиа нельзя изменить. Можно удалить или переслать',
  notYoursEdit: 'Чужое сообщение не редактируется',
  notYoursDelete: 'Чужое сообщение не удаляется',
  needServer: 'Это доступно при подключении к серверу',
  mic: 'Микрофон недоступен',
  offline: 'Нет сети. Сообщение не отправлено',
  savedOffline: 'Текст сохранён и уйдёт, когда появится сеть',
  voiceOnlyComment: 'Голосовой ответ есть только в комментарии',
  empty: 'Здесь пусто',
  sendQuestion: 'Отправить?',
  editQuestion: 'Заменить текст последнего сообщения?',
  deleteQuestion: 'Удалить ваше последнее сообщение? Скажите: да, подтверждаю',
  publishQuestion: 'Опубликовать комментарий?',
  needPreview: 'Нужен открытый предпросмотр или идущая запись',
  confirmDangerHint: 'Скажите: да, подтверждаю',
  recordingLabel: 'Запись',
  previewChoice: 'Отправить или перезаписать?',
} as const

export function previewSpeech(durationMs: number): string {
  const sec = Math.max(1, Math.round(durationMs / 1000))
  return `Запись ${sec} секунд. Отправить или перезаписать?`
}

/** Genitive after «после»: «1 секунды», «3 секунд». */
export function silenceCaption(seconds: number): string {
  const n = Math.max(1, Math.round(seconds))
  const abs = n % 100
  const d = abs % 10
  const word = abs > 10 && abs < 20 ? 'секунд' : d === 1 ? 'секунды' : 'секунд'
  return `Остановлю после ${n} ${word} тишины`
}

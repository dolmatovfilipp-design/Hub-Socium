import type { VoiceCommandContext, VoiceCommandDefinition, VoiceCommandResult } from './types.ts'
import { fail, gate, isResume, said, wrongScreen } from './runtime.ts'

function sheetOpen(ctx: VoiceCommandContext): boolean {
  return ctx.share.open
}

async function copyLink(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!sheetOpen(ctx)) return wrongScreen(ctx)
  const result = await ctx.share.copyLink()
  if (!result.ok) return fail(ctx, result.error || 'Не удалось скопировать ссылку')
  return said('Ссылка скопирована')
}

async function telegram(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !sheetOpen(ctx)) return wrongScreen(ctx)
  if (!sheetOpen(ctx)) return wrongScreen(ctx)
  const blocked = gate(ctx, 'yes', 'Открыть Telegram?', 'telegram')
  if (blocked) return blocked
  ctx.share.openTelegram()
  return said('Открываю Telegram')
}

async function systemShare(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!isResume(ctx) && !sheetOpen(ctx)) return wrongScreen(ctx)
  if (!sheetOpen(ctx)) return wrongScreen(ctx)
  const blocked = gate(ctx, 'yes', 'Открыть системный шаринг?', 'system')
  if (blocked) return blocked
  const result = await ctx.share.systemShare()
  if (!result.ok) return fail(ctx, result.error || 'Не удалось поделиться')
  return said(result.copiedFallback ? 'Ссылка скопирована' : 'Открыт системный шаринг')
}

async function closeShare(ctx: VoiceCommandContext): Promise<VoiceCommandResult> {
  if (!sheetOpen(ctx)) return wrongScreen(ctx)
  ctx.share.close()
  return said('Закрыла')
}

function share(
  partial: Omit<VoiceCommandDefinition, 'group' | 'screens'>,
): VoiceCommandDefinition {
  return {
    group: 'share',
    screens: ['feed', 'post', 'profile', 'market', 'share'],
    ...partial,
  }
}

/**
 * Share sheet commands SH-01 … SH-04.
 * They run only while the sheet is open (`ctx.share.open`), on the screen that opened it.
 */
export const shareCommands: readonly VoiceCommandDefinition[] = [
  share({
    id: 'SH-01',
    phrases: ['копировать ссылку'],
    synonyms: ['копируй'],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Ссылка скопирована',
    handler: copyLink,
  }),
  share({
    id: 'SH-02',
    phrases: ['телеграм'],
    synonyms: [],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Открыть Telegram?',
    handler: telegram,
  }),
  share({
    id: 'SH-03',
    phrases: ['поделиться системой'],
    synonyms: [],
    confirmation: 'yes',
    inReadingSet: false,
    preset: 'none',
    takesSlot: false,
    reply: 'Открыть системный шаринг?',
    handler: systemShare,
  }),
  share({
    id: 'SH-04',
    phrases: ['закрой шаринг'],
    synonyms: [],
    confirmation: 'none',
    inReadingSet: true,
    preset: 'reading',
    takesSlot: false,
    reply: 'Закрыла',
    handler: closeShare,
  }),
]

import { runVoiceCommandSelfTest } from '../src/voice/commands/selftest.ts'

const failures = await runVoiceCommandSelfTest()
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('voice command selftest: ok')

/** Russian cardinal plural: 1 участник, 2 участника, 5 участников. */
export function ruPlural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n)) % 100
  const d = abs % 10
  const word = abs > 10 && abs < 20 ? many : d === 1 ? one : d >= 2 && d <= 4 ? few : many
  return `${n} ${word}`
}

export function ruParticipants(n: number): string {
  return ruPlural(n, 'участник', 'участника', 'участников')
}

/** Computers whose copy of one skill is not the same text as the base computer. */
export function differentPlaces(cells: Record<string, string>, baseId: string): string[] {
  return Object.entries(cells)
    .filter(([id, state]) => id !== baseId && state === 'different')
    .map(([id]) => id)
}

/** How many skills differ on at least one other computer. Missing skills are not counted. */
export function driftCount(rows: Array<{ cells: Record<string, string> }>, baseId: string): number {
  return rows.filter((row) => differentPlaces(row.cells, baseId).length > 0).length
}

/** One line for the skill board. Empty when everything matches. */
export function driftLine(count: number): string {
  if (!count) return ''
  return `다른 컴퓨터와 다른 스킬이 ${count}개 있어요. 이 컴퓨터에 있는 글로 맞출 수 있어요.`
}

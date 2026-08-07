export interface DecisionLedgerEntry {
  id: string
  topic: string
  options: string[]
  chosenOption: string
  rationale: string
  approvedBy: string
  previousEntryHash: string | null
  entryHash: string
  createdAt: number
}

export interface CreateDecisionInput {
  topic: string
  options: string[]
  chosenOption: string
  rationale: string
  approvedBy: string
}

export interface DecisionLedgerResult {
  success: true
  entry: DecisionLedgerEntry
}

export interface DecisionLedgerError {
  success: false
  error: string
}

export type DecisionLedgerResponse = DecisionLedgerResult | DecisionLedgerError

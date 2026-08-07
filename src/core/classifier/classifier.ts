export type DocumentKind = 
  | 'SSOT' | 'PRD' | 'SPEC' | 'WORKFLOW' | 'SKILL' 
  | 'TEMPLATE' | 'RULE' | 'PLAN' | 'EVIDENCE' 
  | 'MEETING' | 'AGENT' | 'CONFIG'

export type Domain = 'AX-GROUP' | 'AI-OFFICE' | 'SYMPHONY' | 'AX-HQ' | 'HERMES' | 'SHARED'
export type Lifecycle = 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'DEPRECATED' | 'ARCHIVED'

const KIND_PATTERNS: Record<DocumentKind, RegExp[]> = {
  SSOT: [/^SSOT[-_]/i, /^MASTER[-_]/i, /^INDEX\.md$/i, /SSOT.*INDEX/i],
  PRD: [/^PRD[-_]/i, /\/prd\//i, /PRODUCT[-_]REQUIREMENTS/i],
  SPEC: [/\/spec(s|ification)?\//i, /^TECH[-_]DESIGN/i, /^ARCHITECTURE/i, /^API[-_]SPEC/i],
  WORKFLOW: [/\/workflow(s)?\//i, /^WORKFLOW[-_]/i, /PIPELINE/i, /AUTOMATION[-_]LOOP/i],
  SKILL: [/\/skills?\//i, /\/SKILL\.md$/i, /\.claude\/skills\//i],
  TEMPLATE: [/\/template(s)?\//i, /^TEMPLATE[-_]/i, /TEMPLATE[-_]FRAMEWORK/i],
  RULE: [/\/rule(s)?\//i, /^RULE[-_]/i, /GOVERNANCE/i, /NAMING[-_]CONVENTION/i],
  PLAN: [/^PLAN[-_]/i, /^ROADMAP/i, /\/goal\//i, /MASTER[-_]ROADMAP/i, /SPRINT[-_]/i, /OKR/i],
  EVIDENCE: [/\/evidence\//i, /-result\.json$/i, /-smoke\.json$/i, /-walkthrough/i],
  MEETING: [/^founding[-_]meeting/i, /\/meeting(s)?\//i, /MEETING[-_]NOTES/i],
  AGENT: [/\/agent(s)?\//i, /\.claude\/agents\//i, /AGENT[-_]DEFINITION/i],
  CONFIG: [/^package\.json$/i, /^tsconfig\.json$/i, /^docker-compose\.ya?ml$/i]
}

const DOMAIN_PATTERNS: Record<Domain, RegExp[]> = {
  'AX-GROUP': [/\/ax[-_]group\//i, /^AX[-_]GROUP/i],
  'AI-OFFICE': [/\/ai[-_]office\//i, /\/ai-office\//i],
  'SYMPHONY': [/\/ju0axsymphony\//i, /\/symphony\//i, /^SYMPHONY/i],
  'AX-HQ': [/\/ax[-_]hq\//i, /^AX[-_]HQ/i],
  'HERMES': [/\/hermes\//i, /^HERMES/i, /\.hermes\//i],
  'SHARED': [/\/shared\//i, /^SHARED/i]
}

const LIFECYCLE_HINTS: Record<Lifecycle, RegExp[]> = {
  DRAFT: [/DRAFT/i, /WIP/i, /초안/, /검토중/],
  APPROVED: [/APPROVED/i, /승인/, /GATE-[345] PASSED/],
  ACTIVE: [/ACTIVE/i, /CURRENT/i, /진행중/],
  DEPRECATED: [/DEPRECATED/i, /OBSOLETE/i, /대체됨/],
  ARCHIVED: [/ARCHIVE/i, /HISTORY/i, /OLD/i]
}

export function classifyDocument(filePath: string, content: string, frontmatter: any): {
  kind: DocumentKind
  domain: Domain
  lifecycle: Lifecycle
} {
  const fileName = filePath.split('/').pop() || filePath
  const fullPath = '/' + filePath

  // 1. Classify Kind
  let kind: DocumentKind = 'PLAN' // default
  for (const [k, patterns] of Object.entries(KIND_PATTERNS)) {
    if (patterns.some(p => p.test(fileName) || p.test(fullPath))) {
      kind = k as DocumentKind
      break
    }
  }

  // 2. Classify Domain
  let domain: Domain = 'SHARED'
  for (const [d, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    if (patterns.some(p => p.test(fullPath))) {
      domain = d as Domain
      break
    }
  }

  // 3. Classify Lifecycle
  let lifecycle: Lifecycle = 'DRAFT'
  const textToCheck = content.slice(0, 1000) + ' ' + JSON.stringify(frontmatter)
  for (const [l, patterns] of Object.entries(LIFECYCLE_HINTS)) {
    if (patterns.some(p => p.test(textToCheck))) {
      lifecycle = l as Lifecycle
      break
    }
  }

  return { kind, domain, lifecycle }
}

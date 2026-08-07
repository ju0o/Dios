#!/usr/bin/env node
import { Command } from 'commander'
import { scanRoots } from '../core/scanner/scanner'

const program = new Command()

program
  .name('dios')
  .description('Document Intelligence & Organization System')
  .version('0.1.0')

program
  .command('scan')
  .description('Scan and index documents from specified roots')
  .option('-r, --roots <paths...>', 'Root directories to scan', ['/d/AXOffice', '/d/Ju0AXSymphony', '/e/Hermes'])
  .action(async (options) => {
    console.log('🔍 Scanning roots:', options.roots)
    
    console.log('⚠️  CLI mode: Database initialization skipped (requires Electron context)')
    console.log('💡 Use the desktop app for full functionality')
    
    const docs = await scanRoots(options.roots)
    console.log(`✅ Found ${docs.length} documents`)
    
    const byKind: Record<string, number> = {}
    for (const doc of docs) {
      const { kind } = await import('../core/classifier/classifier').then(m => 
        m.classifyDocument(doc.path, doc.content, doc.frontmatter)
      )
      byKind[kind] = (byKind[kind] || 0) + 1
    }
    
    console.log('\n📊 Classification summary:')
    for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${kind.padEnd(12)} ${count}`)
    }
  })

program
  .command('search')
  .description('Search documents')
  .argument('<query>', 'Search query')
  .option('-k, --kind <kind>', 'Filter by document kind')
  .option('-d, --domain <domain>', 'Filter by domain')
  .action((query, _options) => {
    console.log('🔎 Searching:', query)
    console.log('⚠️  CLI search requires Electron context (database)')
    console.log('💡 Use the desktop app for search functionality')
  })

program
  .command('report')
  .description('Generate classification report')
  .action(() => {
    console.log('📋 Report generation requires Electron context')
    console.log('💡 Use the desktop app dashboard for reports')
  })

program.parse()

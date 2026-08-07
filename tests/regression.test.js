"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var crypto_1 = require("crypto");
var better_sqlite3_1 = require("better-sqlite3");
var path_1 = require("path");
var os_1 = require("os");
var fs_1 = require("fs");
// ---------------------------------------------------------------------------
// Shared test DB setup helpers
// ---------------------------------------------------------------------------
function setupFullDb() {
    var tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'dios-rt-'));
    var db = new better_sqlite3_1.default(path_1.default.join(tmpDir, 'dios.db'));
    db.pragma('journal_mode = WAL');
    db.exec("\n    CREATE TABLE IF NOT EXISTS documents (\n      id TEXT PRIMARY KEY,\n      path TEXT NOT NULL UNIQUE,\n      rel_path TEXT NOT NULL,\n      kind TEXT NOT NULL,\n      domain TEXT NOT NULL,\n      lifecycle TEXT NOT NULL DEFAULT 'DRAFT',\n      title TEXT,\n      summary TEXT,\n      frontmatter TEXT,\n      content_hash TEXT NOT NULL,\n      word_count INTEGER,\n      created_at INTEGER NOT NULL,\n      updated_at INTEGER NOT NULL,\n      indexed_at INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS document_relations (\n      id TEXT PRIMARY KEY,\n      source_id TEXT NOT NULL REFERENCES documents(id),\n      target_id TEXT NOT NULL REFERENCES documents(id),\n      relation_type TEXT NOT NULL,\n      weight REAL DEFAULT 1.0,\n      created_at INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS ai_resources (\n      id TEXT PRIMARY KEY,\n      name TEXT NOT NULL,\n      provider TEXT NOT NULL,\n      monthly_cap REAL NOT NULL,\n      estimated_cost REAL NOT NULL DEFAULT 0,\n      status TEXT NOT NULL DEFAULT 'normal',\n      created_at INTEGER NOT NULL,\n      updated_at INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS decision_ledger (\n      id TEXT PRIMARY KEY,\n      topic TEXT NOT NULL,\n      options TEXT NOT NULL,\n      chosen_option TEXT NOT NULL,\n      rationale TEXT NOT NULL,\n      approved_by TEXT NOT NULL,\n      previous_entry_hash TEXT,\n      entry_hash TEXT NOT NULL UNIQUE,\n      created_at INTEGER NOT NULL\n    );\n\n    CREATE TRIGGER IF NOT EXISTS decision_ledger_no_update\n    BEFORE UPDATE ON decision_ledger\n    BEGIN\n      SELECT RAISE(ABORT, 'Decision ledger entries are immutable and cannot be modified');\n    END;\n\n    CREATE TRIGGER IF NOT EXISTS decision_ledger_no_delete\n    BEFORE DELETE ON decision_ledger\n    BEGIN\n      SELECT RAISE(ABORT, 'Decision ledger entries are immutable and cannot be deleted');\n    END;\n  ");
    return db;
}
var KIND_PATTERNS = {
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
    CONFIG: [/^package\.json$/i, /^tsconfig\.json$/i, /^docker-compose\.ya?ml$/i],
};
var DOMAIN_PATTERNS = {
    'AX-GROUP': [/\/ax[-_]group\//i, /^AX[-_]GROUP/i],
    'AI-OFFICE': [/\/ai[-_]office\//i, /\/ai-office\//i],
    'SYMPHONY': [/\/ju0axsymphony\//i, /\/symphony\//i, /^SYMPHONY/i],
    'AX-HQ': [/\/ax[-_]hq\//i, /^AX[-_]HQ/i],
    'HERMES': [/\/hermes\//i, /^HERMES/i, /\.hermes\//i],
    'SHARED': [/\/shared\//i, /^SHARED/i],
};
var LIFECYCLE_HINTS = {
    DRAFT: [/DRAFT/i, /WIP/i, /초안/, /검토중/],
    APPROVED: [/APPROVED/i, /승인/, /GATE-[345] PASSED/],
    ACTIVE: [/ACTIVE/i, /CURRENT/i, /진행중/],
    DEPRECATED: [/DEPRECATED/i, /OBSOLETE/i, /대체됨/],
    ARCHIVED: [/ARCHIVE/i, /HISTORY/i, /OLD/i],
};
function classifyDocument(filePath, content, frontmatter) {
    var fileName = filePath.split('/').pop() || filePath;
    var fullPath = '/' + filePath;
    var kind = 'PLAN';
    for (var _i = 0, _a = Object.entries(KIND_PATTERNS); _i < _a.length; _i++) {
        var _b = _a[_i], k = _b[0], patterns = _b[1];
        if (patterns.some(function (p) { return p.test(fileName) || p.test(fullPath); })) {
            kind = k;
            break;
        }
    }
    var domain = 'SHARED';
    for (var _c = 0, _d = Object.entries(DOMAIN_PATTERNS); _c < _d.length; _c++) {
        var _e = _d[_c], d = _e[0], patterns = _e[1];
        if (patterns.some(function (p) { return p.test(fullPath); })) {
            domain = d;
            break;
        }
    }
    var lifecycle = 'DRAFT';
    var textToCheck = content.slice(0, 1000) + ' ' + JSON.stringify(frontmatter);
    for (var _f = 0, _g = Object.entries(LIFECYCLE_HINTS); _f < _g.length; _f++) {
        var _h = _g[_f], l = _h[0], patterns = _h[1];
        if (patterns.some(function (p) { return p.test(textToCheck); })) {
            lifecycle = l;
            break;
        }
    }
    return { kind: kind, domain: domain, lifecycle: lifecycle };
}
function resolveStatus(estimatedCost, monthlyCap) {
    var ratio = monthlyCap > 0 ? estimatedCost / monthlyCap : 0;
    if (ratio >= 1.0)
        return 'hard_stop';
    if (ratio >= 0.8)
        return 'warning';
    return 'normal';
}
function insertDocument(db, filePath, content, frontmatter) {
    var _a;
    if (frontmatter === void 0) { frontmatter = {}; }
    var _b = classifyDocument(filePath, content, frontmatter), kind = _b.kind, domain = _b.domain, lifecycle = _b.lifecycle;
    var id = crypto_1.default.randomUUID();
    var now = Date.now();
    var hash = crypto_1.default.createHash('sha256').update(content).digest('hex');
    var title = frontmatter.title || ((_a = content.split('\n')[0]) === null || _a === void 0 ? void 0 : _a.replace(/^#+\s*/, '')) || null;
    var summary = content.slice(0, 200).replace(/\n/g, ' ');
    var wordCount = content.split(/\s+/).filter(Boolean).length;
    var relPath = filePath.split('/').slice(-2).join('/');
    db.prepare("\n    INSERT OR REPLACE INTO documents\n      (id, path, rel_path, kind, domain, lifecycle, title, summary, frontmatter,\n       content_hash, word_count, created_at, updated_at, indexed_at)\n    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ").run(id, filePath, relPath, kind, domain, lifecycle, title, summary, JSON.stringify(frontmatter), hash, wordCount, now, now, now);
    return id;
}
function createAIResource(db, name, provider, monthlyCap) {
    var id = crypto_1.default.randomUUID();
    var now = Date.now();
    db.prepare("INSERT INTO ai_resources (id, name, provider, monthly_cap, estimated_cost, status, created_at, updated_at)\n     VALUES (?, ?, ?, ?, 0, 'normal', ?, ?)").run(id, name, provider, monthlyCap, now, now);
    return id;
}
function recordAIUsage(db, resourceId, cost) {
    var row = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(resourceId);
    if (!row)
        throw new Error('Resource not found');
    var previousStatus = row.status;
    if (previousStatus === 'hard_stop') {
        return { blocked: true, newStatus: previousStatus, hardStopTriggered: false, softWarningTriggered: false };
    }
    var newCost = row.estimated_cost + cost;
    var newStatus = resolveStatus(newCost, row.monthly_cap);
    var now = Date.now();
    db.prepare('UPDATE ai_resources SET estimated_cost = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(newCost, newStatus, now, resourceId);
    return {
        blocked: false,
        newStatus: newStatus,
        hardStopTriggered: previousStatus !== 'hard_stop' && newStatus === 'hard_stop',
        softWarningTriggered: previousStatus === 'normal' && newStatus === 'warning',
    };
}
function computeEntryHash(id, topic, options, chosenOption, rationale, approvedBy, previousEntryHash, createdAt) {
    var payload = JSON.stringify({ id: id, topic: topic, options: options, chosenOption: chosenOption, rationale: rationale, approvedBy: approvedBy, previousEntryHash: previousEntryHash, createdAt: createdAt });
    return crypto_1.default.createHash('sha256').update(payload, 'utf8').digest('hex');
}
function insertLedgerEntry(db, topic, options, chosenOption, rationale, approvedBy) {
    var _a;
    var lastRow = db.prepare('SELECT entry_hash FROM decision_ledger ORDER BY created_at DESC LIMIT 1').get();
    var previousEntryHash = (_a = lastRow === null || lastRow === void 0 ? void 0 : lastRow.entry_hash) !== null && _a !== void 0 ? _a : null;
    var id = crypto_1.default.randomUUID();
    var createdAt = Date.now();
    var entryHash = computeEntryHash(id, topic, options, chosenOption, rationale, approvedBy, previousEntryHash, createdAt);
    db.prepare("\n    INSERT INTO decision_ledger\n      (id, topic, options, chosen_option, rationale, approved_by, previous_entry_hash, entry_hash, created_at)\n    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)\n  ").run(id, topic, JSON.stringify(options), chosenOption, rationale, approvedBy, previousEntryHash, entryHash, createdAt);
    return { id: id, entryHash: entryHash, previousEntryHash: previousEntryHash };
}
// ---------------------------------------------------------------------------
// RT-01: 문서 스캔 및 DB 저장 (Document scan and DB persistence)
// ---------------------------------------------------------------------------
describe('RT-01: 문서 스캔 및 DB 저장', function () {
    var db;
    beforeEach(function () { db = setupFullDb(); });
    afterEach(function () { db.close(); });
    test('스캔된 문서가 documents 테이블에 정상 저장된다', function () {
        var id = insertDocument(db, 'docs/PRD-001.md', '# Product Requirements\n\nThis is a PRD.');
        var row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
        expect(row).toBeTruthy();
        expect(row.kind).toBe('PRD');
        expect(row.path).toBe('docs/PRD-001.md');
        expect(row.content_hash).toHaveLength(64);
    });
    test('동일 경로 문서를 재스캔하면 REPLACE(upsert)된다', function () {
        insertDocument(db, 'docs/SSOT-main.md', '# First version');
        insertDocument(db, 'docs/SSOT-main.md', '# Updated version');
        var rows = db.prepare("SELECT * FROM documents WHERE path = 'docs/SSOT-main.md'").all();
        expect(rows).toHaveLength(1);
    });
    test('word_count가 올바르게 계산된다', function () {
        var id = insertDocument(db, 'docs/readme.md', 'hello world foo bar baz');
        var row = db.prepare('SELECT word_count FROM documents WHERE id = ?').get(id);
        expect(row.word_count).toBe(5);
    });
});
// ---------------------------------------------------------------------------
// RT-02: 문서 분류 — Kind 판별 (Document classification — Kind)
// ---------------------------------------------------------------------------
describe('RT-02: 문서 분류 — Kind 판별', function () {
    test('PRD 파일명 패턴이 PRD 종류로 분류된다', function () {
        var kind = classifyDocument('docs/PRD-001.md', '', {}).kind;
        expect(kind).toBe('PRD');
    });
    test('SSOT 파일명 패턴이 SSOT 종류로 분류된다', function () {
        var kind = classifyDocument('docs/SSOT-master.md', '', {}).kind;
        expect(kind).toBe('SSOT');
    });
    test('workflow 경로가 WORKFLOW 종류로 분류된다', function () {
        var kind = classifyDocument('workflows/deployment.md', '', {}).kind;
        expect(kind).toBe('WORKFLOW');
    });
    test('spec 경로가 SPEC 종류로 분류된다', function () {
        var kind = classifyDocument('specs/api-design.md', '', {}).kind;
        expect(kind).toBe('SPEC');
    });
    test('알 수 없는 파일은 기본값 PLAN으로 분류된다', function () {
        var kind = classifyDocument('random/unknown-doc.md', '', {}).kind;
        expect(kind).toBe('PLAN');
    });
    test('evidence 경로가 EVIDENCE 종류로 분류된다', function () {
        var kind = classifyDocument('evidence/test-result.json', '', {}).kind;
        expect(kind).toBe('EVIDENCE');
    });
});
// ---------------------------------------------------------------------------
// RT-03: 문서 분류 — Domain 판별 (Document classification — Domain)
// ---------------------------------------------------------------------------
describe('RT-03: 문서 분류 — Domain 판별', function () {
    test('symphony 경로가 SYMPHONY 도메인으로 분류된다', function () {
        var domain = classifyDocument('ju0axsymphony/PRD-001.md', '', {}).domain;
        expect(domain).toBe('SYMPHONY');
    });
    test('hermes 경로가 HERMES 도메인으로 분류된다', function () {
        var domain = classifyDocument('hermes/workflow.md', '', {}).domain;
        expect(domain).toBe('HERMES');
    });
    test('ai-office 경로가 AI-OFFICE 도메인으로 분류된다', function () {
        var domain = classifyDocument('ai-office/spec.md', '', {}).domain;
        expect(domain).toBe('AI-OFFICE');
    });
    test('분류 불가 경로는 기본값 SHARED 도메인으로 분류된다', function () {
        var domain = classifyDocument('misc/notes.md', '', {}).domain;
        expect(domain).toBe('SHARED');
    });
});
// ---------------------------------------------------------------------------
// RT-04: 문서 분류 — Lifecycle 판별 (Document classification — Lifecycle)
// ---------------------------------------------------------------------------
describe('RT-04: 문서 분류 — Lifecycle 판별', function () {
    test('APPROVED 키워드가 있으면 APPROVED lifecycle으로 분류된다', function () {
        var lifecycle = classifyDocument('docs/prd.md', 'Status: APPROVED\n\nContent here.', {}).lifecycle;
        expect(lifecycle).toBe('APPROVED');
    });
    test('DEPRECATED 키워드가 있으면 DEPRECATED lifecycle으로 분류된다', function () {
        var lifecycle = classifyDocument('docs/old.md', 'This document is DEPRECATED.\n', {}).lifecycle;
        expect(lifecycle).toBe('DEPRECATED');
    });
    test('ACTIVE 키워드가 있으면 ACTIVE lifecycle으로 분류된다', function () {
        var lifecycle = classifyDocument('docs/cur.md', 'Status: ACTIVE\n\nContent.', {}).lifecycle;
        expect(lifecycle).toBe('ACTIVE');
    });
    test('키워드 없으면 기본값 DRAFT lifecycle으로 분류된다', function () {
        var lifecycle = classifyDocument('docs/new.md', 'Some content without status keywords.', {}).lifecycle;
        expect(lifecycle).toBe('DRAFT');
    });
});
// ---------------------------------------------------------------------------
// RT-05: 문서 검색 (Document search with filters)
// ---------------------------------------------------------------------------
describe('RT-05: 문서 검색', function () {
    var db;
    beforeEach(function () {
        db = setupFullDb();
        insertDocument(db, 'docs/PRD-product.md', '# Product Requirements\n\nFeature overview for the product.');
        insertDocument(db, 'docs/SSOT-master.md', '# Master Index\n\nSSoT for all documents.');
        insertDocument(db, 'workflows/deploy.md', '# Deploy Workflow\n\nAutomation pipeline.');
    });
    afterEach(function () { db.close(); });
    test('kind 필터로 PRD 문서만 조회된다', function () {
        var rows = db.prepare("SELECT * FROM documents WHERE kind = 'PRD'").all();
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe('PRD');
    });
    test('title LIKE 검색으로 문서를 찾을 수 있다', function () {
        var rows = db.prepare("SELECT * FROM documents WHERE title LIKE '%Master%'").all();
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe('SSOT');
    });
    test('복수 문서가 존재하면 모두 조회된다', function () {
        var rows = db.prepare('SELECT * FROM documents').all();
        expect(rows).toHaveLength(3);
    });
    test('summary LIKE 검색으로 내용 기반 조회가 된다', function () {
        var rows = db.prepare("SELECT * FROM documents WHERE summary LIKE '%pipeline%'").all();
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe('WORKFLOW');
    });
});
// ---------------------------------------------------------------------------
// RT-06: 그래프 관계 생성 (Graph relation building)
// ---------------------------------------------------------------------------
describe('RT-06: 그래프 관계 생성', function () {
    var db;
    beforeEach(function () { db = setupFullDb(); });
    afterEach(function () { db.close(); });
    test('PRD→SPEC 관계를 document_relations에 저장할 수 있다', function () {
        var prdId = insertDocument(db, 'docs/PRD-001.md', '# PRD');
        var specId = insertDocument(db, 'specs/api.md', '# API Spec');
        var relId = crypto_1.default.randomUUID();
        db.prepare("INSERT INTO document_relations (id, source_id, target_id, relation_type, weight, created_at)\n       VALUES (?, ?, ?, 'IMPLEMENTS', 0.9, ?)").run(relId, prdId, specId, Date.now());
        var rel = db.prepare('SELECT * FROM document_relations WHERE id = ?').get(relId);
        expect(rel.relation_type).toBe('IMPLEMENTS');
        expect(rel.weight).toBe(0.9);
        expect(rel.source_id).toBe(prdId);
        expect(rel.target_id).toBe(specId);
    });
    test('같은 도메인 PRD와 WORKFLOW 관계가 존재한다', function () {
        var prdId = insertDocument(db, 'symphony/PRD-feature.md', '# PRD');
        var wfId = insertDocument(db, 'symphony/workflows/ship.md', '# Deploy Workflow');
        var relId = crypto_1.default.randomUUID();
        db.prepare("INSERT INTO document_relations (id, source_id, target_id, relation_type, weight, created_at)\n       VALUES (?, ?, ?, 'IMPLEMENTS', 0.8, ?)").run(relId, prdId, wfId, Date.now());
        var count = db.prepare('SELECT COUNT(*) as cnt FROM document_relations').get().cnt;
        expect(count).toBe(1);
    });
    test('존재하지 않는 document_id로 relation 삽입 시 FOREIGN KEY 또는 에러가 발생한다', function () {
        db.pragma('foreign_keys = ON');
        expect(function () {
            db.prepare("INSERT INTO document_relations (id, source_id, target_id, relation_type, weight, created_at)\n         VALUES (?, ?, ?, 'IMPLEMENTS', 1.0, ?)").run(crypto_1.default.randomUUID(), 'nonexistent-id', 'also-nonexistent', Date.now());
        }).toThrow();
    });
});
// ---------------------------------------------------------------------------
// RT-07: AI Resource — 생성 및 조회 (AI Resource create & read)
// ---------------------------------------------------------------------------
describe('RT-07: AI Resource — 생성 및 조회', function () {
    var db;
    beforeEach(function () { db = setupFullDb(); });
    afterEach(function () { db.close(); });
    test('AI 리소스가 정상 생성되고 초기 상태는 normal이다', function () {
        var id = createAIResource(db, 'GPT-4o', 'OpenAI', 100);
        var row = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id);
        expect(row).toBeTruthy();
        expect(row.name).toBe('GPT-4o');
        expect(row.status).toBe('normal');
        expect(row.estimated_cost).toBe(0);
        expect(row.monthly_cap).toBe(100);
    });
    test('복수 AI 리소스가 독립적으로 존재한다', function () {
        createAIResource(db, 'GPT-4o', 'OpenAI', 100);
        createAIResource(db, 'Claude', 'Anthropic', 200);
        createAIResource(db, 'Gemini', 'Google', 150);
        var rows = db.prepare('SELECT * FROM ai_resources').all();
        expect(rows).toHaveLength(3);
    });
});
// ---------------------------------------------------------------------------
// RT-08: AI Resource — 비용 추적 및 상태 전환 (Cost tracking & status transition)
// ---------------------------------------------------------------------------
describe('RT-08: AI Resource — 비용 추적 및 상태 전환', function () {
    var db;
    beforeEach(function () { db = setupFullDb(); });
    afterEach(function () { db.close(); });
    test('비용이 80%에 도달하면 warning 상태로 전환된다', function () {
        var id = createAIResource(db, 'GPT-4o', 'OpenAI', 100);
        var result = recordAIUsage(db, id, 80);
        expect(result.newStatus).toBe('warning');
        expect(result.softWarningTriggered).toBe(true);
        expect(result.blocked).toBe(false);
    });
    test('비용이 100%에 도달하면 hard_stop 상태로 전환된다', function () {
        var id = createAIResource(db, 'Claude', 'Anthropic', 100);
        recordAIUsage(db, id, 80);
        var result = recordAIUsage(db, id, 20);
        expect(result.newStatus).toBe('hard_stop');
        expect(result.hardStopTriggered).toBe(true);
    });
    test('hard_stop 상태에서는 추가 사용이 차단된다', function () {
        var id = createAIResource(db, 'Llama', 'Meta', 100);
        recordAIUsage(db, id, 100);
        var result = recordAIUsage(db, id, 10);
        expect(result.blocked).toBe(true);
        var row = db.prepare('SELECT estimated_cost FROM ai_resources WHERE id = ?').get(id);
        expect(row.estimated_cost).toBe(100);
    });
});
// ---------------------------------------------------------------------------
// RT-09: AI Resource — 멀티 리소스 예산 독립성 (Multi-resource budget independence)
// ---------------------------------------------------------------------------
describe('RT-09: AI Resource — 멀티 리소스 예산 독립성', function () {
    var db;
    beforeEach(function () { db = setupFullDb(); });
    afterEach(function () { db.close(); });
    test('A 리소스의 hard_stop이 B 리소스에 영향을 주지 않는다', function () {
        var idA = createAIResource(db, 'ResourceA', 'ProviderA', 100);
        var idB = createAIResource(db, 'ResourceB', 'ProviderB', 100);
        recordAIUsage(db, idA, 100);
        var resultB = recordAIUsage(db, idB, 50);
        expect(resultB.blocked).toBe(false);
        expect(resultB.newStatus).toBe('normal');
        var rowA = db.prepare('SELECT status FROM ai_resources WHERE id = ?').get(idA);
        var rowB = db.prepare('SELECT status FROM ai_resources WHERE id = ?').get(idB);
        expect(rowA.status).toBe('hard_stop');
        expect(rowB.status).toBe('normal');
    });
    test('각 리소스의 estimated_cost가 독립적으로 누적된다', function () {
        var idA = createAIResource(db, 'A', 'P', 100);
        var idB = createAIResource(db, 'B', 'P', 100);
        recordAIUsage(db, idA, 30);
        recordAIUsage(db, idA, 20);
        recordAIUsage(db, idB, 45);
        var rowA = db.prepare('SELECT estimated_cost FROM ai_resources WHERE id = ?').get(idA);
        var rowB = db.prepare('SELECT estimated_cost FROM ai_resources WHERE id = ?').get(idB);
        expect(rowA.estimated_cost).toBe(50);
        expect(rowB.estimated_cost).toBe(45);
    });
});
// ---------------------------------------------------------------------------
// RT-10: AI Resource — 월간 리셋 (Monthly usage reset)
// ---------------------------------------------------------------------------
describe('RT-10: AI Resource — 월간 리셋', function () {
    var db;
    beforeEach(function () { db = setupFullDb(); });
    afterEach(function () { db.close(); });
    test('hard_stop 리소스를 리셋하면 normal 상태로 복원된다', function () {
        var id = createAIResource(db, 'Resettable', 'Provider', 100);
        recordAIUsage(db, id, 100);
        var before = db.prepare('SELECT status FROM ai_resources WHERE id = ?').get(id);
        expect(before.status).toBe('hard_stop');
        db.prepare("UPDATE ai_resources SET estimated_cost = 0, status = 'normal', updated_at = ? WHERE id = ?")
            .run(Date.now(), id);
        var after = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id);
        expect(after.status).toBe('normal');
        expect(after.estimated_cost).toBe(0);
    });
    test('리셋 후 새로운 비용을 정상 누적할 수 있다', function () {
        var id = createAIResource(db, 'Monthly', 'Provider', 100);
        recordAIUsage(db, id, 100);
        db.prepare("UPDATE ai_resources SET estimated_cost = 0, status = 'normal', updated_at = ? WHERE id = ?")
            .run(Date.now(), id);
        var result = recordAIUsage(db, id, 30);
        expect(result.blocked).toBe(false);
        expect(result.newStatus).toBe('normal');
        var row = db.prepare('SELECT estimated_cost FROM ai_resources WHERE id = ?').get(id);
        expect(row.estimated_cost).toBe(30);
    });
});
// ---------------------------------------------------------------------------
// RT-11: Decision Ledger — 불변성 및 해시 체인 (Immutability & hash chain)
// ---------------------------------------------------------------------------
describe('RT-11: Decision Ledger — 불변성 및 해시 체인', function () {
    var db;
    beforeEach(function () { db = setupFullDb(); });
    afterEach(function () { db.close(); });
    test('첫 번째 항목의 previousEntryHash는 null이다', function () {
        var previousEntryHash = insertLedgerEntry(db, 'DB 선택', ['PostgreSQL', 'MySQL'], 'PostgreSQL', 'JSON 지원', 'alice').previousEntryHash;
        expect(previousEntryHash).toBeNull();
    });
    test('두 번째 항목의 previousEntryHash는 첫 번째 항목의 entryHash와 같다', function () {
        var first = insertLedgerEntry(db, 'DB 선택', ['PostgreSQL', 'MySQL'], 'PostgreSQL', '이유', 'alice');
        var second = insertLedgerEntry(db, '프레임워크 선택', ['React', 'Vue'], 'React', '팀 친숙도', 'bob');
        expect(second.previousEntryHash).toBe(first.entryHash);
    });
    test('항목에 대한 UPDATE는 immutable 트리거에 의해 차단된다', function () {
        var id = insertLedgerEntry(db, 'Topic', ['A', 'B'], 'A', 'reason', 'alice').id;
        expect(function () {
            db.prepare('UPDATE decision_ledger SET topic = ? WHERE id = ?').run('tampered', id);
        }).toThrow(/immutable/);
    });
    test('항목에 대한 DELETE는 immutable 트리거에 의해 차단된다', function () {
        var id = insertLedgerEntry(db, 'Topic', ['X', 'Y'], 'X', 'reason', 'bob').id;
        expect(function () {
            db.prepare('DELETE FROM decision_ledger WHERE id = ?').run(id);
        }).toThrow(/immutable/);
    });
    test('해시 체인 무결성이 복수 항목에 걸쳐 유지된다', function () {
        insertLedgerEntry(db, 'Topic 1', ['A', 'B'], 'A', 'r1', 'alice');
        insertLedgerEntry(db, 'Topic 2', ['C', 'D'], 'C', 'r2', 'bob');
        insertLedgerEntry(db, 'Topic 3', ['E', 'F'], 'E', 'r3', 'carol');
        var rows = db.prepare('SELECT * FROM decision_ledger ORDER BY created_at ASC').all();
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var expectedPrev = i === 0 ? null : rows[i - 1].entry_hash;
            expect(row.previous_entry_hash).toBe(expectedPrev);
            var recomputed = computeEntryHash(row.id, row.topic, JSON.parse(row.options), row.chosen_option, row.rationale, row.approved_by, row.previous_entry_hash, row.created_at);
            expect(recomputed).toBe(row.entry_hash);
        }
    });
});
// ---------------------------------------------------------------------------
// RT-12: 전체 시스템 통합 시나리오 (End-to-end system scenario)
// ---------------------------------------------------------------------------
describe('RT-12: 전체 시스템 통합 시나리오', function () {
    var db;
    beforeEach(function () { db = setupFullDb(); });
    afterEach(function () { db.close(); });
    test('문서 스캔 → 분류 → 저장 → AI 비용 추적 → 결정 기록 통합 시나리오', function () {
        // 1. 문서 스캔 & 저장
        var prdId = insertDocument(db, 'symphony/PRD-001.md', '# Symphony PRD\n\nStatus: APPROVED\n\nCore requirements.');
        var specId = insertDocument(db, 'symphony/specs/api.md', '# API Specification\n\nRESTful API design.');
        var wfId = insertDocument(db, 'symphony/workflows/deploy-pipeline.md', '# Deploy Pipeline\n\nAUTOMATION_LOOP for CI/CD.');
        var docs = db.prepare('SELECT * FROM documents').all();
        expect(docs).toHaveLength(3);
        var prd = docs.find(function (d) { return d.id === prdId; });
        expect(prd.kind).toBe('PRD');
        expect(prd.domain).toBe('SYMPHONY');
        expect(prd.lifecycle).toBe('APPROVED');
        var spec = docs.find(function (d) { return d.id === specId; });
        expect(spec.kind).toBe('SPEC');
        var wf = docs.find(function (d) { return d.id === wfId; });
        expect(wf.kind).toBe('WORKFLOW');
        // 2. 그래프 관계 생성
        var rel1Id = crypto_1.default.randomUUID();
        var rel2Id = crypto_1.default.randomUUID();
        db.prepare("INSERT INTO document_relations (id, source_id, target_id, relation_type, weight, created_at)\n       VALUES (?, ?, ?, 'IMPLEMENTS', 0.9, ?)").run(rel1Id, prdId, specId, Date.now());
        db.prepare("INSERT INTO document_relations (id, source_id, target_id, relation_type, weight, created_at)\n       VALUES (?, ?, ?, 'IMPLEMENTS', 0.8, ?)").run(rel2Id, prdId, wfId, Date.now());
        var relations = db.prepare('SELECT * FROM document_relations').all();
        expect(relations).toHaveLength(2);
        // 3. AI 리소스 비용 추적
        var aiId = createAIResource(db, 'Claude-3.5-Sonnet', 'Anthropic', 50);
        recordAIUsage(db, aiId, 40);
        var warnResult = recordAIUsage(db, aiId, 5);
        expect(warnResult.newStatus).toBe('warning');
        recordAIUsage(db, aiId, 5);
        var stopResult = recordAIUsage(db, aiId, 0.01);
        expect(stopResult.blocked).toBe(true);
        // 4. 결정 원장 기록
        var entry1 = insertLedgerEntry(db, 'PRD 승인 여부', ['승인', '반려'], '승인', '품질 기준 충족', 'CTO');
        var entry2 = insertLedgerEntry(db, 'API 설계 확정', ['REST', 'GraphQL'], 'REST', '팀 경험', 'Architect');
        expect(entry1.previousEntryHash).toBeNull();
        expect(entry2.previousEntryHash).toBe(entry1.entryHash);
        var ledgerRows = db.prepare('SELECT COUNT(*) as cnt FROM decision_ledger').get();
        expect(ledgerRows.cnt).toBe(2);
        // 5. 전체 상태 검증
        var allDocs = db.prepare('SELECT * FROM documents ORDER BY indexed_at ASC').all();
        expect(allDocs).toHaveLength(3);
        var aiRow = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(aiId);
        expect(aiRow.status).toBe('hard_stop');
    });
});
var VALID_TRANSITIONS = {
    DRAFT: ['HYPOTHESIS'],
    HYPOTHESIS: ['VALIDATION', 'TERMINATED'],
    VALIDATION: ['APPROVED', 'PIVOT', 'TERMINATED'],
    APPROVED: ['RUNNING', 'HOLD', 'TERMINATED'],
    RUNNING: ['SCALE', 'PIVOT', 'HOLD', 'TERMINATED'],
    SCALE: ['HOLD', 'TERMINATED'],
    PIVOT: ['HYPOTHESIS', 'TERMINATED'],
    HOLD: ['RUNNING', 'TERMINATED'],
    TERMINATED: [],
};
var CEO_REQUIRED_TARGETS = [
    'VALIDATION', 'APPROVED', 'RUNNING', 'SCALE', 'PIVOT', 'HOLD', 'TERMINATED',
];
function requiresCeoApproval(toState) {
    return CEO_REQUIRED_TARGETS.includes(toState);
}
function setupExperimentDb() {
    var tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'dios-exp-'));
    var db = new better_sqlite3_1.default(path_1.default.join(tmpDir, 'dios.db'));
    db.pragma('journal_mode = WAL');
    db.exec("\n    CREATE TABLE IF NOT EXISTS experiments (\n      id TEXT PRIMARY KEY,\n      name TEXT NOT NULL,\n      description TEXT NOT NULL DEFAULT '',\n      state TEXT NOT NULL DEFAULT 'DRAFT',\n      created_by TEXT NOT NULL,\n      approved_by TEXT,\n      approved_at INTEGER,\n      created_at INTEGER NOT NULL,\n      updated_at INTEGER NOT NULL\n    );\n    CREATE TABLE IF NOT EXISTS experiment_transitions (\n      id TEXT PRIMARY KEY,\n      experiment_id TEXT NOT NULL REFERENCES experiments(id),\n      from_state TEXT NOT NULL,\n      to_state TEXT NOT NULL,\n      triggered_by TEXT NOT NULL,\n      role TEXT NOT NULL,\n      rationale TEXT,\n      created_at INTEGER NOT NULL\n    );\n  ");
    return db;
}
function createExperimentInDb(db, name, createdBy) {
    var id = crypto_1.default.randomUUID();
    var now = Date.now();
    db.prepare("INSERT INTO experiments (id, name, description, state, created_by, approved_by, approved_at, created_at, updated_at)\n     VALUES (?, ?, '', 'DRAFT', ?, NULL, NULL, ?, ?)").run(id, name, createdBy, now, now);
    return id;
}
function transitionExperimentInDb(db, experimentId, toState, triggeredBy, role, rationale) {
    var row = db.prepare('SELECT * FROM experiments WHERE id = ?').get(experimentId);
    if (!row)
        return { ok: false, code: 'NOT_FOUND', message: '실험을 찾을 수 없습니다.' };
    var currentState = row.state;
    var allowed = VALID_TRANSITIONS[currentState];
    if (!allowed.includes(toState)) {
        return { ok: false, code: 'INVALID_TRANSITION', message: "".concat(currentState, " \u2192 ").concat(toState, " \uC804\uC774\uB294 \uD5C8\uC6A9\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.") };
    }
    if (requiresCeoApproval(toState) && role !== 'CEO') {
        return { ok: false, code: 'CEO_APPROVAL_REQUIRED', message: "".concat(toState, " \uC804\uC774\uB294 CEO \uC2B9\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.") };
    }
    var now = Date.now();
    var approvedBy = requiresCeoApproval(toState) ? triggeredBy : null;
    var approvedAt = requiresCeoApproval(toState) ? now : null;
    db.prepare("UPDATE experiments SET state = ?, approved_by = COALESCE(?, approved_by), approved_at = COALESCE(?, approved_at), updated_at = ? WHERE id = ?").run(toState, approvedBy, approvedAt, now, experimentId);
    db.prepare("INSERT INTO experiment_transitions (id, experiment_id, from_state, to_state, triggered_by, role, rationale, created_at)\n     VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(crypto_1.default.randomUUID(), experimentId, currentState, toState, triggeredBy, role, rationale !== null && rationale !== void 0 ? rationale : null, now);
    return { ok: true, state: toState };
}
// ---------------------------------------------------------------------------
// RT-13: Experiment 상태 기계 — Hermes-B 제한 (AC: Hermes-B 단독으로 HYPOTHESIS 이상 단계로 전이할 수 없다)
// ---------------------------------------------------------------------------
describe('RT-13: Experiment 상태 기계', function () {
    var db;
    beforeEach(function () { db = setupExperimentDb(); });
    afterEach(function () { db.close(); });
    test('실험이 DRAFT 상태로 생성된다', function () {
        var id = createExperimentInDb(db, '실험 A', 'hermes-b');
        var row = db.prepare('SELECT * FROM experiments WHERE id = ?').get(id);
        expect(row.state).toBe('DRAFT');
    });
    test('Hermes-B는 DRAFT → HYPOTHESIS 전이를 수행할 수 있다', function () {
        var id = createExperimentInDb(db, '실험 B', 'hermes-b');
        var result = transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B');
        expect(result.ok).toBe(true);
        if (result.ok)
            expect(result.state).toBe('HYPOTHESIS');
    });
    test('Hermes-B 단독으로 HYPOTHESIS → VALIDATION 전이를 수행할 수 없다 (AC-1)', function () {
        var id = createExperimentInDb(db, '실험 C', 'hermes-b');
        transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B');
        var result = transitionExperimentInDb(db, id, 'VALIDATION', 'hermes-b', 'HERMES_B');
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.code).toBe('CEO_APPROVAL_REQUIRED');
    });
    test('CEO는 HYPOTHESIS → VALIDATION 전이를 수행할 수 있다', function () {
        var id = createExperimentInDb(db, '실험 D', 'hermes-b');
        transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B');
        var result = transitionExperimentInDb(db, id, 'VALIDATION', 'ceo@company.com', 'CEO');
        expect(result.ok).toBe(true);
        if (result.ok)
            expect(result.state).toBe('VALIDATION');
    });
    test('Hermes-B 단독으로 APPROVED 전이를 수행할 수 없다 (AC-1)', function () {
        var id = createExperimentInDb(db, '실험 E', 'hermes-b');
        transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B');
        transitionExperimentInDb(db, id, 'VALIDATION', 'ceo@company.com', 'CEO');
        var result = transitionExperimentInDb(db, id, 'APPROVED', 'hermes-b', 'HERMES_B');
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.code).toBe('CEO_APPROVAL_REQUIRED');
    });
    test('Hermes-B 단독으로 RUNNING 전이를 수행할 수 없다 (AC-1)', function () {
        var id = createExperimentInDb(db, '실험 F', 'hermes-b');
        transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B');
        transitionExperimentInDb(db, id, 'VALIDATION', 'ceo@company.com', 'CEO');
        transitionExperimentInDb(db, id, 'APPROVED', 'ceo@company.com', 'CEO');
        var result = transitionExperimentInDb(db, id, 'RUNNING', 'hermes-b', 'HERMES_B');
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.code).toBe('CEO_APPROVAL_REQUIRED');
    });
    test('허용되지 않는 상태 전이는 거부된다', function () {
        var id = createExperimentInDb(db, '실험 G', 'hermes-b');
        var result = transitionExperimentInDb(db, id, 'RUNNING', 'ceo@company.com', 'CEO');
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.code).toBe('INVALID_TRANSITION');
    });
    test('TERMINATED 상태에서는 어떠한 전이도 불가능하다', function () {
        var id = createExperimentInDb(db, '실험 H', 'hermes-b');
        transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B');
        transitionExperimentInDb(db, id, 'TERMINATED', 'ceo@company.com', 'CEO');
        var result = transitionExperimentInDb(db, id, 'HYPOTHESIS', 'ceo@company.com', 'CEO');
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.code).toBe('INVALID_TRANSITION');
    });
    test('전이 이력이 experiment_transitions에 기록된다', function () {
        var id = createExperimentInDb(db, '실험 I', 'hermes-b');
        transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B', '가설 설정');
        transitionExperimentInDb(db, id, 'VALIDATION', 'ceo@company.com', 'CEO', 'CEO 승인');
        var rows = db.prepare('SELECT * FROM experiment_transitions WHERE experiment_id = ? ORDER BY created_at ASC').all(id);
        expect(rows).toHaveLength(2);
        expect(rows[0].from_state).toBe('DRAFT');
        expect(rows[0].to_state).toBe('HYPOTHESIS');
        expect(rows[1].from_state).toBe('HYPOTHESIS');
        expect(rows[1].to_state).toBe('VALIDATION');
        expect(rows[1].role).toBe('CEO');
    });
    test('CEO 승인 전이 시 approved_by와 approved_at이 기록된다', function () {
        var id = createExperimentInDb(db, '실험 J', 'hermes-b');
        transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B');
        transitionExperimentInDb(db, id, 'VALIDATION', 'ceo@company.com', 'CEO');
        var row = db.prepare('SELECT * FROM experiments WHERE id = ?').get(id);
        expect(row.approved_by).toBe('ceo@company.com');
        expect(row.approved_at).toBeGreaterThan(0);
    });
    test('PIVOT → HYPOTHESIS → VALIDATION 순환 경로를 CEO 주도로 진행할 수 있다', function () {
        var id = createExperimentInDb(db, '실험 K', 'hermes-b');
        transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B');
        transitionExperimentInDb(db, id, 'VALIDATION', 'ceo@company.com', 'CEO');
        transitionExperimentInDb(db, id, 'APPROVED', 'ceo@company.com', 'CEO');
        transitionExperimentInDb(db, id, 'RUNNING', 'ceo@company.com', 'CEO');
        transitionExperimentInDb(db, id, 'PIVOT', 'ceo@company.com', 'CEO');
        var r1 = transitionExperimentInDb(db, id, 'HYPOTHESIS', 'hermes-b', 'HERMES_B');
        expect(r1.ok).toBe(true);
        var r2 = transitionExperimentInDb(db, id, 'VALIDATION', 'ceo@company.com', 'CEO');
        expect(r2.ok).toBe(true);
        var row = db.prepare('SELECT state FROM experiments WHERE id = ?').get(id);
        expect(row.state).toBe('VALIDATION');
    });
});

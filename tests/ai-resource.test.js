"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var crypto_1 = require("crypto");
var better_sqlite3_1 = require("better-sqlite3");
var path_1 = require("path");
var os_1 = require("os");
var fs_1 = require("fs");
var db;
function setupTestDb() {
    var tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'dios-ai-test-'));
    var testDb = new better_sqlite3_1.default(path_1.default.join(tmpDir, 'test.db'));
    testDb.pragma('journal_mode = WAL');
    testDb.exec("\n    CREATE TABLE IF NOT EXISTS ai_resources (\n      id TEXT PRIMARY KEY,\n      name TEXT NOT NULL,\n      provider TEXT NOT NULL,\n      monthly_cap REAL NOT NULL,\n      estimated_cost REAL NOT NULL DEFAULT 0,\n      status TEXT NOT NULL DEFAULT 'normal',\n      created_at INTEGER NOT NULL,\n      updated_at INTEGER NOT NULL\n    );\n  ");
    return testDb;
}
var SOFT_WARNING_THRESHOLD = 0.8;
var HARD_STOP_THRESHOLD = 1.0;
function resolveStatus(estimatedCost, monthlyCap) {
    var ratio = monthlyCap > 0 ? estimatedCost / monthlyCap : 0;
    if (ratio >= HARD_STOP_THRESHOLD)
        return 'hard_stop';
    if (ratio >= SOFT_WARNING_THRESHOLD)
        return 'warning';
    return 'normal';
}
function createResource(testDb, name, provider, monthlyCap) {
    var id = crypto_1.default.randomUUID();
    var now = Date.now();
    testDb
        .prepare("INSERT INTO ai_resources (id, name, provider, monthly_cap, estimated_cost, status, created_at, updated_at)\n       VALUES (?, ?, ?, ?, 0, 'normal', ?, ?)")
        .run(id, name, provider, monthlyCap, now, now);
    return id;
}
function recordUsage(testDb, resourceId, cost) {
    var row = testDb.prepare('SELECT * FROM ai_resources WHERE id = ?').get(resourceId);
    if (!row)
        throw new Error('Resource not found');
    var previousStatus = row.status;
    if (previousStatus === 'hard_stop') {
        return { blocked: true, previousStatus: previousStatus, newStatus: previousStatus, softWarning: false, hardStop: false };
    }
    var newCost = row.estimated_cost + cost;
    var newStatus = resolveStatus(newCost, row.monthly_cap);
    var now = Date.now();
    testDb
        .prepare('UPDATE ai_resources SET estimated_cost = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(newCost, newStatus, now, resourceId);
    return {
        blocked: false,
        previousStatus: previousStatus,
        newStatus: newStatus,
        softWarning: previousStatus === 'normal' && newStatus === 'warning',
        hardStop: previousStatus !== 'hard_stop' && newStatus === 'hard_stop',
    };
}
describe('AI Resource — status thresholds', function () {
    beforeEach(function () { db = setupTestDb(); });
    afterEach(function () { db.close(); });
    test('resolveStatus returns normal below 80%', function () {
        expect(resolveStatus(70, 100)).toBe('normal');
        expect(resolveStatus(0, 100)).toBe('normal');
        expect(resolveStatus(79.99, 100)).toBe('normal');
    });
    test('resolveStatus returns warning at 80%', function () {
        expect(resolveStatus(80, 100)).toBe('warning');
        expect(resolveStatus(85, 100)).toBe('warning');
        expect(resolveStatus(99.99, 100)).toBe('warning');
    });
    test('resolveStatus returns hard_stop at 100%', function () {
        expect(resolveStatus(100, 100)).toBe('hard_stop');
        expect(resolveStatus(150, 100)).toBe('hard_stop');
    });
    test('resolveStatus returns normal when monthlyCap is 0', function () {
        expect(resolveStatus(0, 0)).toBe('normal');
    });
});
describe('AI Resource — recordUsage soft warning', function () {
    beforeEach(function () { db = setupTestDb(); });
    afterEach(function () { db.close(); });
    test('transitions from normal to warning triggers softWarning flag', function () {
        var id = createResource(db, 'GPT-4o', 'OpenAI', 100);
        var result = recordUsage(db, id, 80);
        expect(result.blocked).toBe(false);
        expect(result.previousStatus).toBe('normal');
        expect(result.newStatus).toBe('warning');
        expect(result.softWarning).toBe(true);
        expect(result.hardStop).toBe(false);
    });
    test('warning status persists without re-triggering softWarning on subsequent usage', function () {
        var id = createResource(db, 'Claude', 'Anthropic', 100);
        recordUsage(db, id, 80);
        var result = recordUsage(db, id, 5);
        expect(result.previousStatus).toBe('warning');
        expect(result.newStatus).toBe('warning');
        expect(result.softWarning).toBe(false);
    });
});
describe('AI Resource — Hard Stop', function () {
    beforeEach(function () { db = setupTestDb(); });
    afterEach(function () { db.close(); });
    test('transitions to hard_stop at 100% triggers hardStop flag', function () {
        var id = createResource(db, 'Gemini', 'Google', 100);
        recordUsage(db, id, 80);
        var result = recordUsage(db, id, 20);
        expect(result.blocked).toBe(false);
        expect(result.newStatus).toBe('hard_stop');
        expect(result.hardStop).toBe(true);
    });
    test('hard_stop blocks subsequent usage calls', function () {
        var id = createResource(db, 'Llama', 'Meta', 100);
        recordUsage(db, id, 100);
        var result = recordUsage(db, id, 1);
        expect(result.blocked).toBe(true);
        var row = db.prepare('SELECT estimated_cost FROM ai_resources WHERE id = ?').get(id);
        expect(row.estimated_cost).toBe(100);
    });
    test('estimated_cost does not increase when hard_stop is active', function () {
        var id = createResource(db, 'Mistral', 'Mistral AI', 50);
        recordUsage(db, id, 50);
        recordUsage(db, id, 10);
        recordUsage(db, id, 10);
        var row = db.prepare('SELECT estimated_cost FROM ai_resources WHERE id = ?').get(id);
        expect(row.estimated_cost).toBe(50);
    });
});
describe('AI Resource — reset monthly usage', function () {
    beforeEach(function () { db = setupTestDb(); });
    afterEach(function () { db.close(); });
    test('resetting usage returns status to normal and cost to 0', function () {
        var id = createResource(db, 'Reset Test', 'Provider', 100);
        recordUsage(db, id, 100);
        var before = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id);
        expect(before.status).toBe('hard_stop');
        var now = Date.now();
        db.prepare("UPDATE ai_resources SET estimated_cost = 0, status = 'normal', updated_at = ? WHERE id = ?")
            .run(now, id);
        var after = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id);
        expect(after.estimated_cost).toBe(0);
        expect(after.status).toBe('normal');
    });
});
describe('AI Resource — edge cases', function () {
    beforeEach(function () { db = setupTestDb(); });
    afterEach(function () { db.close(); });
    test('single-step from normal to hard_stop skips warning and sets hardStop=true', function () {
        var id = createResource(db, 'BigSpend', 'Provider', 100);
        var result = recordUsage(db, id, 100);
        expect(result.newStatus).toBe('hard_stop');
        expect(result.hardStop).toBe(true);
        expect(result.softWarning).toBe(false);
    });
    test('accumulated costs across multiple small calls trigger warning correctly', function () {
        var id = createResource(db, 'Incremental', 'Provider', 100);
        for (var i = 0; i < 8; i++) {
            recordUsage(db, id, 9);
        }
        var rowBefore = db.prepare('SELECT * FROM ai_resources WHERE id = ?').get(id);
        expect(rowBefore.status).toBe('normal');
        var result = recordUsage(db, id, 9);
        expect(result.newStatus).toBe('warning');
        expect(result.softWarning).toBe(true);
    });
});

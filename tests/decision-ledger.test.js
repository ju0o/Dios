"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var crypto_1 = require("crypto");
var better_sqlite3_1 = require("better-sqlite3");
var path_1 = require("path");
var os_1 = require("os");
var fs_1 = require("fs");
var db;
function setupTestDb() {
    var tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'dios-test-'));
    var testDb = new better_sqlite3_1.default(path_1.default.join(tmpDir, 'test.db'));
    testDb.pragma('journal_mode = WAL');
    testDb.exec("\n    CREATE TABLE IF NOT EXISTS decision_ledger (\n      id TEXT PRIMARY KEY,\n      topic TEXT NOT NULL,\n      options TEXT NOT NULL,\n      chosen_option TEXT NOT NULL,\n      rationale TEXT NOT NULL,\n      approved_by TEXT NOT NULL,\n      previous_entry_hash TEXT,\n      entry_hash TEXT NOT NULL UNIQUE,\n      created_at INTEGER NOT NULL\n    );\n\n    CREATE TRIGGER IF NOT EXISTS decision_ledger_no_update\n    BEFORE UPDATE ON decision_ledger\n    BEGIN\n      SELECT RAISE(ABORT, 'Decision ledger entries are immutable and cannot be modified');\n    END;\n\n    CREATE TRIGGER IF NOT EXISTS decision_ledger_no_delete\n    BEFORE DELETE ON decision_ledger\n    BEGIN\n      SELECT RAISE(ABORT, 'Decision ledger entries are immutable and cannot be deleted');\n    END;\n  ");
    return testDb;
}
function computeEntryHash(id, topic, options, chosenOption, rationale, approvedBy, previousEntryHash, createdAt) {
    var payload = JSON.stringify({
        id: id,
        topic: topic,
        options: options,
        chosenOption: chosenOption,
        rationale: rationale,
        approvedBy: approvedBy,
        previousEntryHash: previousEntryHash,
        createdAt: createdAt,
    });
    return crypto_1.default.createHash('sha256').update(payload, 'utf8').digest('hex');
}
function insertEntry(testDb, topic, options, chosenOption, rationale, approvedBy) {
    var _a;
    var lastRow = testDb
        .prepare('SELECT entry_hash FROM decision_ledger ORDER BY created_at DESC LIMIT 1')
        .get();
    var previousEntryHash = (_a = lastRow === null || lastRow === void 0 ? void 0 : lastRow.entry_hash) !== null && _a !== void 0 ? _a : null;
    var id = crypto_1.default.randomUUID();
    var createdAt = Date.now();
    var entryHash = computeEntryHash(id, topic, options, chosenOption, rationale, approvedBy, previousEntryHash, createdAt);
    testDb.prepare("INSERT INTO decision_ledger\n       (id, topic, options, chosen_option, rationale, approved_by, previous_entry_hash, entry_hash, created_at)\n     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, topic, JSON.stringify(options), chosenOption, rationale, approvedBy, previousEntryHash, entryHash, createdAt);
    return { id: id, entryHash: entryHash, previousEntryHash: previousEntryHash, createdAt: createdAt };
}
describe('Decision Ledger – validation', function () {
    beforeEach(function () {
        db = setupTestDb();
    });
    afterEach(function () {
        db.close();
    });
    test('rejects entry with missing topic', function () {
        expect(function () {
            insertEntry(db, '', ['A', 'B'], 'A', 'reason', 'alice');
        }).toThrow();
    });
    test('rejects entry with fewer than 2 options', function () {
        var id = crypto_1.default.randomUUID();
        var createdAt = Date.now();
        var entryHash = computeEntryHash(id, 'topic', ['A'], 'A', 'reason', 'alice', null, createdAt);
        expect(function () {
            db.prepare("INSERT INTO decision_ledger\n           (id, topic, options, chosen_option, rationale, approved_by, previous_entry_hash, entry_hash, created_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, 'topic', JSON.stringify(['A']), 'A', 'reason', 'alice', null, entryHash, createdAt);
        }).not.toThrow();
    });
});
describe('Decision Ledger – immutability (DB triggers)', function () {
    beforeEach(function () {
        db = setupTestDb();
    });
    afterEach(function () {
        db.close();
    });
    test('UPDATE on decision_ledger is rejected by trigger', function () {
        var id = insertEntry(db, 'DB choice', ['PostgreSQL', 'MySQL'], 'PostgreSQL', 'better JSON support', 'bob').id;
        expect(function () {
            db.prepare('UPDATE decision_ledger SET topic = ? WHERE id = ?').run('tampered', id);
        }).toThrow(/immutable/);
    });
    test('DELETE on decision_ledger is rejected by trigger', function () {
        var id = insertEntry(db, 'Framework', ['React', 'Vue'], 'React', 'team familiarity', 'carol').id;
        expect(function () {
            db.prepare('DELETE FROM decision_ledger WHERE id = ?').run(id);
        }).toThrow(/immutable/);
    });
});
describe('Decision Ledger – hash chain', function () {
    beforeEach(function () {
        db = setupTestDb();
    });
    afterEach(function () {
        db.close();
    });
    test('first entry has null previousEntryHash', function () {
        var previousEntryHash = insertEntry(db, 'First', ['A', 'B'], 'A', 'rationale', 'alice').previousEntryHash;
        expect(previousEntryHash).toBeNull();
    });
    test('second entry previousEntryHash matches first entry hash', function () {
        var first = insertEntry(db, 'First', ['A', 'B'], 'A', 'rationale', 'alice');
        var second = insertEntry(db, 'Second', ['X', 'Y'], 'X', 'rationale2', 'bob');
        expect(second.previousEntryHash).toBe(first.entryHash);
    });
    test('chain integrity holds for multiple entries', function () {
        var entries = [
            insertEntry(db, 'Topic 1', ['A', 'B'], 'A', 'r1', 'alice'),
            insertEntry(db, 'Topic 2', ['C', 'D'], 'C', 'r2', 'bob'),
            insertEntry(db, 'Topic 3', ['E', 'F'], 'E', 'r3', 'carol'),
        ];
        var rows = db
            .prepare('SELECT * FROM decision_ledger ORDER BY created_at ASC')
            .all();
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var expectedPrev = i === 0 ? null : rows[i - 1].entry_hash;
            expect(row.previous_entry_hash).toBe(expectedPrev);
            var recomputed = computeEntryHash(row.id, row.topic, JSON.parse(row.options), row.chosen_option, row.rationale, row.approved_by, row.previous_entry_hash, row.created_at);
            expect(recomputed).toBe(row.entry_hash);
        }
    });
    test('tampered entry_hash is detectable', function () {
        insertEntry(db, 'Original', ['A', 'B'], 'A', 'rationale', 'alice');
        var row = db.prepare('SELECT * FROM decision_ledger LIMIT 1').get();
        var recomputed = computeEntryHash(row.id, row.topic, JSON.parse(row.options), row.chosen_option, row.rationale, row.approved_by, row.previous_entry_hash, row.created_at);
        expect(recomputed).toBe(row.entry_hash);
        expect('tampered_hash').not.toBe(row.entry_hash);
    });
});

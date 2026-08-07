"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var crypto_1 = require("crypto");
var better_sqlite3_1 = require("better-sqlite3");
var path_1 = require("path");
var os_1 = require("os");
var fs_1 = require("fs");
function setupHumanGateDb() {
    var tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'dios-hg-'));
    var db = new better_sqlite3_1.default(path_1.default.join(tmpDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    db.exec("\n    CREATE TABLE IF NOT EXISTS human_gate_config (\n      id TEXT PRIMARY KEY,\n      level TEXT NOT NULL,\n      name TEXT NOT NULL,\n      description TEXT NOT NULL,\n      soft_threshold REAL NOT NULL,\n      hard_threshold REAL NOT NULL,\n      enabled INTEGER NOT NULL DEFAULT 1,\n      created_at INTEGER NOT NULL,\n      updated_at INTEGER NOT NULL\n    );\n\n    CREATE TABLE IF NOT EXISTS human_gate_events (\n      id TEXT PRIMARY KEY,\n      gate_id TEXT NOT NULL REFERENCES human_gate_config(id),\n      event_type TEXT NOT NULL,\n      triggered_by TEXT NOT NULL,\n      old_value TEXT,\n      new_value TEXT,\n      approved INTEGER,\n      approved_by TEXT,\n      approved_at INTEGER,\n      rationale TEXT,\n      created_at INTEGER NOT NULL\n    );\n\n    CREATE TRIGGER IF NOT EXISTS human_gate_config_no_delete\n    BEFORE DELETE ON human_gate_config\n    BEGIN\n      SELECT RAISE(ABORT, 'Human Gate config entries cannot be deleted; disable instead');\n    END;\n  ");
    return db;
}
function createGate(db, level, name, softThreshold, hardThreshold) {
    var id = crypto_1.default.randomUUID();
    var now = Date.now();
    db.prepare("INSERT INTO human_gate_config\n       (id, level, name, description, soft_threshold, hard_threshold, enabled, created_at, updated_at)\n     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").run(id, level, name, "".concat(name, " description"), softThreshold, hardThreshold, now, now);
    return id;
}
function requestThresholdChange(db, gateId, softThreshold, hardThreshold, requestedBy, rationale) {
    if (!requestedBy.trim())
        return { error: 'requestedBy는 필수입니다.' };
    if (!rationale.trim())
        return { error: 'rationale은 필수입니다.' };
    if (softThreshold < 0 || softThreshold > 1)
        return { error: 'softThreshold 범위 오류' };
    if (hardThreshold < 0 || hardThreshold > 1)
        return { error: 'hardThreshold 범위 오류' };
    if (softThreshold >= hardThreshold)
        return { error: 'softThreshold는 hardThreshold보다 작아야 합니다.' };
    var gateRow = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId);
    if (!gateRow)
        return { error: "\uAC8C\uC774\uD2B8 ".concat(gateId, "\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.") };
    if (!gateRow.enabled)
        return { error: '비활성화된 게이트의 임계값은 변경할 수 없습니다.' };
    var oldValue = JSON.stringify({ softThreshold: gateRow.soft_threshold, hardThreshold: gateRow.hard_threshold });
    var newValue = JSON.stringify({ softThreshold: softThreshold, hardThreshold: hardThreshold });
    var eventId = crypto_1.default.randomUUID();
    var now = Date.now();
    db.prepare("INSERT INTO human_gate_events\n       (id, gate_id, event_type, triggered_by, old_value, new_value, approved, approved_by, approved_at, rationale, created_at)\n     VALUES (?, ?, 'THRESHOLD_CHANGE', ?, ?, ?, NULL, NULL, NULL, ?, ?)").run(eventId, gateId, requestedBy.trim(), oldValue, newValue, rationale.trim(), now);
    return { eventId: eventId, gateTriggered: true, pendingApproval: true };
}
function approveThresholdChange(db, eventId, approvedBy, approved, rationale) {
    if (!approvedBy.trim())
        return { error: 'approvedBy는 필수입니다.' };
    var eventRow = db.prepare('SELECT * FROM human_gate_events WHERE id = ?').get(eventId);
    if (!eventRow)
        return { error: "\uC774\uBCA4\uD2B8 ".concat(eventId, "\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.") };
    if (eventRow.event_type !== 'THRESHOLD_CHANGE')
        return { error: '임계값 변경 이벤트가 아닙니다.' };
    if (eventRow.approved !== null)
        return { error: '이미 처리된 이벤트입니다.' };
    var now = Date.now();
    db.prepare("UPDATE human_gate_events SET approved = ?, approved_by = ?, approved_at = ?, rationale = ? WHERE id = ?").run(approved ? 1 : 0, approvedBy.trim(), now, rationale !== null && rationale !== void 0 ? rationale : null, eventId);
    if (approved && eventRow.new_value) {
        var _a = JSON.parse(eventRow.new_value), softThreshold = _a.softThreshold, hardThreshold = _a.hardThreshold;
        db.prepare("UPDATE human_gate_config SET soft_threshold = ?, hard_threshold = ?, updated_at = ? WHERE id = ?").run(softThreshold, hardThreshold, now, eventRow.gate_id);
    }
    return { ok: true };
}
describe('RT-14: Human Gate — 임계값 변경 시 게이트 발동', function () {
    var db;
    beforeEach(function () { db = setupHumanGateDb(); });
    afterEach(function () { db.close(); });
    test('임계값 변경 요청 시 THRESHOLD_CHANGE 이벤트가 즉시 생성된다 (AC-1)', function () {
        var gateId = createGate(db, 'COMPANY', '회사 수준 게이트', 0.7, 0.9);
        var result = requestThresholdChange(db, gateId, 0.6, 0.85, 'alice@example.com', '정책 변경으로 인한 조정');
        expect('error' in result).toBe(false);
        if ('error' in result)
            return;
        expect(result.gateTriggered).toBe(true);
        expect(result.pendingApproval).toBe(true);
        var event = db.prepare('SELECT * FROM human_gate_events WHERE id = ?').get(result.eventId);
        expect(event).toBeTruthy();
        expect(event.event_type).toBe('THRESHOLD_CHANGE');
        expect(event.approved).toBeNull();
    });
    test('임계값 변경 요청 후 승인 전까지 실제 임계값은 변경되지 않는다 (우회 차단)', function () {
        var gateId = createGate(db, 'FINANCE', '재무 수준 게이트', 0.6, 0.8);
        requestThresholdChange(db, gateId, 0.4, 0.7, 'bob@example.com', '재무 정책 완화');
        var gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId);
        expect(gate.soft_threshold).toBe(0.6);
        expect(gate.hard_threshold).toBe(0.8);
    });
    test('승인 후에만 임계값이 실제로 적용된다', function () {
        var gateId = createGate(db, 'AI_RESOURCE', 'AI 리소스 게이트', 0.5, 0.75);
        var reqResult = requestThresholdChange(db, gateId, 0.4, 0.65, 'carol@example.com', 'AI 예산 절감');
        if ('error' in reqResult)
            throw new Error(reqResult.error);
        approveThresholdChange(db, reqResult.eventId, 'approver@example.com', true, '검토 후 승인');
        var gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId);
        expect(gate.soft_threshold).toBe(0.4);
        expect(gate.hard_threshold).toBe(0.65);
    });
    test('거부 시 임계값이 변경되지 않는다', function () {
        var gateId = createGate(db, 'GOVERNANCE', '거버넌스 게이트', 0.8, 1.0);
        var reqResult = requestThresholdChange(db, gateId, 0.5, 0.7, 'dave@example.com', '임시 완화');
        if ('error' in reqResult)
            throw new Error(reqResult.error);
        approveThresholdChange(db, reqResult.eventId, 'approver@example.com', false, '정책 위반으로 거부');
        var gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId);
        expect(gate.soft_threshold).toBe(0.8);
        expect(gate.hard_threshold).toBe(1.0);
    });
    test('요청자 미입력 시 게이트 요청이 거부된다', function () {
        var gateId = createGate(db, 'COMPANY', '회사 게이트', 0.7, 0.9);
        var result = requestThresholdChange(db, gateId, 0.6, 0.85, '', '사유 있음');
        expect('error' in result).toBe(true);
        var events = db.prepare('SELECT COUNT(*) as cnt FROM human_gate_events').get();
        expect(events.cnt).toBe(0);
    });
    test('변경 사유 미입력 시 게이트 요청이 거부된다', function () {
        var gateId = createGate(db, 'COMPANY', '회사 게이트', 0.7, 0.9);
        var result = requestThresholdChange(db, gateId, 0.6, 0.85, 'alice@example.com', '');
        expect('error' in result).toBe(true);
        var events = db.prepare('SELECT COUNT(*) as cnt FROM human_gate_events').get();
        expect(events.cnt).toBe(0);
    });
    test('soft >= hard 임계값은 게이트 요청이 거부된다', function () {
        var gateId = createGate(db, 'FINANCE', '재무 게이트', 0.6, 0.8);
        var result = requestThresholdChange(db, gateId, 0.8, 0.8, 'alice@example.com', '사유');
        expect('error' in result).toBe(true);
    });
    test('비활성화된 게이트의 임계값은 변경할 수 없다', function () {
        var gateId = createGate(db, 'AI_RESOURCE', 'AI 게이트', 0.5, 0.75);
        db.prepare('UPDATE human_gate_config SET enabled = 0 WHERE id = ?').run(gateId);
        var result = requestThresholdChange(db, gateId, 0.4, 0.65, 'alice@example.com', '변경 시도');
        expect('error' in result).toBe(true);
        if ('error' in result)
            expect(result.error).toContain('비활성화');
    });
    test('이미 처리된 이벤트를 재처리하면 거부된다', function () {
        var gateId = createGate(db, 'COMPANY', '회사 게이트', 0.7, 0.9);
        var reqResult = requestThresholdChange(db, gateId, 0.6, 0.85, 'alice@example.com', '사유');
        if ('error' in reqResult)
            throw new Error(reqResult.error);
        approveThresholdChange(db, reqResult.eventId, 'approver@example.com', true);
        var result = approveThresholdChange(db, reqResult.eventId, 'approver2@example.com', true);
        expect('error' in result).toBe(true);
        if ('error' in result)
            expect(result.error).toContain('이미 처리');
    });
    test('Human Gate config 삭제는 DB 트리거에 의해 차단된다', function () {
        var gateId = createGate(db, 'GOVERNANCE', '거버넌스 게이트', 0.8, 1.0);
        expect(function () {
            db.prepare('DELETE FROM human_gate_config WHERE id = ?').run(gateId);
        }).toThrow(/cannot be deleted/);
    });
});
describe('RT-15: Human Gate — 4개 수준 게이트 시드 및 독립성', function () {
    var db;
    beforeEach(function () { db = setupHumanGateDb(); });
    afterEach(function () { db.close(); });
    function seedDefaultGates() {
        var defaults = [
            { level: 'COMPANY', name: '회사 수준 게이트', soft: 0.7, hard: 0.9 },
            { level: 'FINANCE', name: '재무 수준 게이트', soft: 0.6, hard: 0.8 },
            { level: 'AI_RESOURCE', name: 'AI 리소스 수준 게이트', soft: 0.5, hard: 0.75 },
            { level: 'GOVERNANCE', name: '거버넌스 수준 게이트', soft: 0.8, hard: 1.0 },
        ];
        for (var _i = 0, defaults_1 = defaults; _i < defaults_1.length; _i++) {
            var g = defaults_1[_i];
            createGate(db, g.level, g.name, g.soft, g.hard);
        }
    }
    test('4개 기본 게이트가 모두 생성된다', function () {
        seedDefaultGates();
        var rows = db.prepare('SELECT * FROM human_gate_config').all();
        expect(rows).toHaveLength(4);
    });
    test('각 게이트 수준이 고유하다', function () {
        seedDefaultGates();
        var rows = db.prepare('SELECT DISTINCT level FROM human_gate_config').all();
        expect(rows).toHaveLength(4);
        var levels = rows.map(function (r) { return r.level; });
        expect(levels).toContain('COMPANY');
        expect(levels).toContain('FINANCE');
        expect(levels).toContain('AI_RESOURCE');
        expect(levels).toContain('GOVERNANCE');
    });
    test('한 게이트의 임계값 변경이 다른 게이트에 영향을 주지 않는다', function () {
        seedDefaultGates();
        var companyId = db.prepare("SELECT id FROM human_gate_config WHERE level = 'COMPANY'").get().id;
        var financeId = db.prepare("SELECT id FROM human_gate_config WHERE level = 'FINANCE'").get().id;
        var reqResult = requestThresholdChange(db, companyId, 0.5, 0.8, 'alice@example.com', '전략 변경');
        if ('error' in reqResult)
            throw new Error(reqResult.error);
        approveThresholdChange(db, reqResult.eventId, 'approver@example.com', true);
        var companyGate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(companyId);
        var financeGate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(financeId);
        expect(companyGate.soft_threshold).toBe(0.5);
        expect(financeGate.soft_threshold).toBe(0.6);
    });
    test('게이트 비활성화가 즉시 적용된다', function () {
        seedDefaultGates();
        var gateId = db.prepare("SELECT id FROM human_gate_config WHERE level = 'GOVERNANCE'").get().id;
        var now = Date.now();
        db.prepare("INSERT INTO human_gate_events\n         (id, gate_id, event_type, triggered_by, old_value, new_value, approved, approved_by, approved_at, rationale, created_at)\n       VALUES (?, ?, 'DISABLE', ?, 'true', 'false', 1, ?, ?, NULL, ?)").run(crypto_1.default.randomUUID(), gateId, 'admin@example.com', 'admin@example.com', now, now);
        db.prepare('UPDATE human_gate_config SET enabled = 0, updated_at = ? WHERE id = ?').run(now, gateId);
        var gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId);
        expect(gate.enabled).toBe(0);
        var result = requestThresholdChange(db, gateId, 0.5, 0.7, 'alice@example.com', '변경 시도');
        expect('error' in result).toBe(true);
    });
    test('복수의 임계값 변경 요청이 각각 독립된 이벤트로 기록된다', function () {
        seedDefaultGates();
        var gateId = db.prepare("SELECT id FROM human_gate_config WHERE level = 'FINANCE'").get().id;
        var r1 = requestThresholdChange(db, gateId, 0.55, 0.75, 'alice@example.com', '1차 조정');
        if ('error' in r1)
            throw new Error(r1.error);
        approveThresholdChange(db, r1.eventId, 'approver@example.com', false, '거부');
        var r2 = requestThresholdChange(db, gateId, 0.5, 0.7, 'bob@example.com', '2차 조정');
        if ('error' in r2)
            throw new Error(r2.error);
        approveThresholdChange(db, r2.eventId, 'approver@example.com', true, '승인');
        var events = db.prepare('SELECT * FROM human_gate_events WHERE gate_id = ? ORDER BY created_at ASC').all(gateId);
        expect(events).toHaveLength(2);
        expect(events[0].approved).toBe(0);
        expect(events[1].approved).toBe(1);
        var gate = db.prepare('SELECT * FROM human_gate_config WHERE id = ?').get(gateId);
        expect(gate.soft_threshold).toBe(0.5);
        expect(gate.hard_threshold).toBe(0.7);
    });
});

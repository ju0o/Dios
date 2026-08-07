"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var crypto_1 = require("crypto");
var better_sqlite3_1 = require("better-sqlite3");
var path_1 = require("path");
var os_1 = require("os");
var fs_1 = require("fs");
var vitest_1 = require("vitest");
// ---------------------------------------------------------------------------
// Test DB setup with audit_log table
// ---------------------------------------------------------------------------
function setupDb() {
    var tmpDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'dios-eb-'));
    var db = new better_sqlite3_1.default(path_1.default.join(tmpDir, 'dios.db'));
    db.pragma('journal_mode = WAL');
    db.exec("\n    CREATE TABLE IF NOT EXISTS audit_log (\n      id TEXT PRIMARY KEY,\n      actor TEXT NOT NULL,\n      action_type TEXT NOT NULL,\n      execution_class TEXT NOT NULL CHECK(execution_class IN ('AUTONOMOUS', 'HUMAN_GATE_REQUIRED')),\n      status TEXT NOT NULL CHECK(status IN ('EXECUTED', 'BLOCKED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),\n      payload TEXT,\n      rationale TEXT,\n      gate_event_id TEXT,\n      created_at INTEGER NOT NULL\n    );\n\n    CREATE TRIGGER IF NOT EXISTS audit_log_no_update\n    BEFORE UPDATE ON audit_log\n    BEGIN\n      SELECT RAISE(ABORT, 'Audit log entries are immutable and cannot be modified');\n    END;\n\n    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete\n    BEFORE DELETE ON audit_log\n    BEGIN\n      SELECT RAISE(ABORT, 'Audit log entries are immutable and cannot be deleted');\n    END;\n  ");
    return db;
}
var types_1 = require("../src/core/automation/types");
function rowToEntry(row) {
    return {
        id: row.id,
        actor: row.actor,
        actionType: row.action_type,
        executionClass: row.execution_class,
        status: row.status,
        payload: row.payload ? JSON.parse(row.payload) : null,
        rationale: row.rationale,
        gateEventId: row.gate_event_id,
        createdAt: row.created_at,
    };
}
function makeRecordAudit(db) {
    return function recordAudit(input) {
        var _a, _b;
        var id = crypto_1.default.randomUUID();
        var now = Date.now();
        db.prepare("INSERT INTO audit_log\n         (id, actor, action_type, execution_class, status, payload, rationale, gate_event_id, created_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.actor, input.actionType, input.executionClass, input.status, input.payload ? JSON.stringify(input.payload) : null, (_a = input.rationale) !== null && _a !== void 0 ? _a : null, (_b = input.gateEventId) !== null && _b !== void 0 ? _b : null, now);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id);
        return rowToEntry(row);
    };
}
function makeExecuteAutonomous(db) {
    var recordAudit = makeRecordAudit(db);
    return function executeAutonomous(input, fn) {
        var executionClass = (0, types_1.classifyAction)(input.actionType);
        if (executionClass !== 'AUTONOMOUS') {
            var entry = recordAudit({
                actor: input.actor,
                actionType: input.actionType,
                executionClass: 'HUMAN_GATE_REQUIRED',
                status: 'BLOCKED',
                payload: input.payload,
                rationale: input.rationale,
            });
            return { ok: false, error: { code: 'HUMAN_GATE_REQUIRED', message: "".concat(input.actionType, " \uCC28\uB2E8\uB428") }, auditId: entry.id };
        }
        try {
            var result = fn();
            var entry = recordAudit({
                actor: input.actor,
                actionType: input.actionType,
                executionClass: 'AUTONOMOUS',
                status: 'EXECUTED',
                payload: input.payload,
                rationale: input.rationale,
            });
            return { ok: true, data: result, auditId: entry.id };
        }
        catch (err) {
            var entry = recordAudit({
                actor: input.actor,
                actionType: input.actionType,
                executionClass: 'AUTONOMOUS',
                status: 'BLOCKED',
                rationale: String(err),
            });
            return { ok: false, error: { code: 'EXECUTION_ERROR', message: String(err) }, auditId: entry.id };
        }
    };
}
function makeRequestHumanGate(db) {
    var recordAudit = makeRecordAudit(db);
    return function requestHumanGateAction(input) {
        if (!types_1.HUMAN_GATE_ACTIONS.has(input.actionType)) {
            var entry_1 = recordAudit({
                actor: input.actor,
                actionType: input.actionType,
                executionClass: 'AUTONOMOUS',
                status: 'BLOCKED',
                rationale: '자율 실행 범위 외 행위 요청',
            });
            return { ok: false, error: { code: 'INVALID_ACTION_CLASS', message: "".concat(input.actionType, "\uC740 Human Gate \uB300\uC0C1\uC774 \uC544\uB2D9\uB2C8\uB2E4.") }, auditId: entry_1.id };
        }
        var entry = recordAudit({
            actor: input.actor,
            actionType: input.actionType,
            executionClass: 'HUMAN_GATE_REQUIRED',
            status: 'PENDING_APPROVAL',
            payload: input.payload,
            rationale: input.rationale,
        });
        return { ok: true, data: { pendingAuditId: entry.id }, auditId: entry.id };
    };
}
// ---------------------------------------------------------------------------
// Tests: RT-16 — Execution Boundary & AuditLog
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('RT-16: 자율 실행 범위 & Human Gate 경계 분리', function () {
    var db;
    var executeAutonomous;
    var requestHumanGate;
    var recordAudit;
    (0, vitest_1.beforeEach)(function () {
        db = setupDb();
        executeAutonomous = makeExecuteAutonomous(db);
        requestHumanGate = makeRequestHumanGate(db);
        recordAudit = makeRecordAudit(db);
    });
    // -------------------------------------------------------------------------
    // AC1: 모든 자율 실행 행위는 100% AuditLog에 기록됨
    // -------------------------------------------------------------------------
    (0, vitest_1.it)('AC1-1: SIGNAL_COLLECT 자율 실행이 AuditLog에 EXECUTED로 기록된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'SIGNAL_COLLECT' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(true);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row).toBeDefined();
        (0, vitest_1.expect)(row.actor).toBe('HERMES_B');
        (0, vitest_1.expect)(row.action_type).toBe('SIGNAL_COLLECT');
        (0, vitest_1.expect)(row.execution_class).toBe('AUTONOMOUS');
        (0, vitest_1.expect)(row.status).toBe('EXECUTED');
    });
    (0, vitest_1.it)('AC1-2: SIGNAL_SCORE 자율 실행이 AuditLog에 EXECUTED로 기록된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'SIGNAL_SCORE', payload: { score: 0.85 } }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(true);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.action_type).toBe('SIGNAL_SCORE');
        (0, vitest_1.expect)(row.status).toBe('EXECUTED');
        (0, vitest_1.expect)(JSON.parse(row.payload)).toEqual({ score: 0.85 });
    });
    (0, vitest_1.it)('AC1-3: REPORT_GENERATE 자율 실행이 AuditLog에 EXECUTED로 기록된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'REPORT_GENERATE' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(true);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.action_type).toBe('REPORT_GENERATE');
        (0, vitest_1.expect)(row.status).toBe('EXECUTED');
    });
    (0, vitest_1.it)('AC1-4: LOOP_HEARTBEAT 자율 실행이 AuditLog에 EXECUTED로 기록된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'LOOP_HEARTBEAT' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(true);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.action_type).toBe('LOOP_HEARTBEAT');
        (0, vitest_1.expect)(row.execution_class).toBe('AUTONOMOUS');
    });
    (0, vitest_1.it)('AC1-5: EXPERIMENT_DRAFT_CREATE 자율 실행이 AuditLog에 EXECUTED로 기록된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'EXPERIMENT_DRAFT_CREATE' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(true);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('EXECUTED');
    });
    (0, vitest_1.it)('AC1-6: EXPERIMENT_HYPOTHESIS_ADVANCE 자율 실행이 AuditLog에 EXECUTED로 기록된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'EXPERIMENT_HYPOTHESIS_ADVANCE' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(true);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('EXECUTED');
    });
    (0, vitest_1.it)('AC1-7: 자율 실행 중 예외 발생시 BLOCKED로 AuditLog에 기록된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'SIGNAL_COLLECT' }, function () {
            throw new Error('네트워크 오류');
        });
        (0, vitest_1.expect)(result.ok).toBe(false);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('BLOCKED');
        (0, vitest_1.expect)(row.execution_class).toBe('AUTONOMOUS');
        (0, vitest_1.expect)(row.rationale).toContain('네트워크 오류');
    });
    // -------------------------------------------------------------------------
    // Human Gate 경계 강제
    // -------------------------------------------------------------------------
    (0, vitest_1.it)('HG-1: BUSINESS_CREATE는 Human Gate 대상으로 자율 실행이 차단된다', function () {
        var _a;
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'BUSINESS_CREATE' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(false);
        (0, vitest_1.expect)((_a = result.error) === null || _a === void 0 ? void 0 : _a.code).toBe('HUMAN_GATE_REQUIRED');
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('BLOCKED');
        (0, vitest_1.expect)(row.execution_class).toBe('HUMAN_GATE_REQUIRED');
    });
    (0, vitest_1.it)('HG-2: BUDGET_CHANGE는 Human Gate 대상으로 자율 실행이 차단된다', function () {
        var _a;
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'BUDGET_CHANGE' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(false);
        (0, vitest_1.expect)((_a = result.error) === null || _a === void 0 ? void 0 : _a.code).toBe('HUMAN_GATE_REQUIRED');
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('BLOCKED');
    });
    (0, vitest_1.it)('HG-3: ORDER_PLACE는 Human Gate 대상으로 자율 실행이 차단된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'ORDER_PLACE' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(false);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.execution_class).toBe('HUMAN_GATE_REQUIRED');
    });
    (0, vitest_1.it)('HG-4: DELIVERY_ACCEPT는 Human Gate 대상으로 자율 실행이 차단된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'DELIVERY_ACCEPT' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(false);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('BLOCKED');
    });
    (0, vitest_1.it)('HG-5: BUSINESS_TERMINATE는 Human Gate 대상으로 자율 실행이 차단된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'BUSINESS_TERMINATE' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(false);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('BLOCKED');
    });
    (0, vitest_1.it)('HG-6: EXPERIMENT_VALIDATE는 Human Gate 대상으로 자율 실행이 차단된다', function () {
        var _a;
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'EXPERIMENT_VALIDATE' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(false);
        (0, vitest_1.expect)((_a = result.error) === null || _a === void 0 ? void 0 : _a.code).toBe('HUMAN_GATE_REQUIRED');
    });
    (0, vitest_1.it)('HG-7: EXPERIMENT_APPROVE는 Human Gate 대상으로 자율 실행이 차단된다', function () {
        var result = executeAutonomous({ actor: 'HERMES_B', actionType: 'EXPERIMENT_APPROVE' }, function () { return undefined; });
        (0, vitest_1.expect)(result.ok).toBe(false);
    });
    (0, vitest_1.it)('HG-8: requestHumanGate가 BUSINESS_CREATE를 PENDING_APPROVAL로 AuditLog에 기록한다', function () {
        var _a;
        var result = requestHumanGate({
            actor: 'HERMES_B',
            actionType: 'BUSINESS_CREATE',
            payload: { name: '신사업 Alpha' },
            rationale: '시장 기회 포착',
        });
        (0, vitest_1.expect)(result.ok).toBe(true);
        (0, vitest_1.expect)((_a = result.data) === null || _a === void 0 ? void 0 : _a.pendingAuditId).toBeDefined();
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('PENDING_APPROVAL');
        (0, vitest_1.expect)(row.execution_class).toBe('HUMAN_GATE_REQUIRED');
        (0, vitest_1.expect)(JSON.parse(row.payload)).toEqual({ name: '신사업 Alpha' });
    });
    (0, vitest_1.it)('HG-9: requestHumanGate가 BUDGET_CHANGE를 PENDING_APPROVAL로 기록한다', function () {
        var result = requestHumanGate({
            actor: 'HERMES_B',
            actionType: 'BUDGET_CHANGE',
            payload: { amount: 5000000, currency: 'KRW' },
            rationale: '분기 예산 증액 필요',
        });
        (0, vitest_1.expect)(result.ok).toBe(true);
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('PENDING_APPROVAL');
    });
    (0, vitest_1.it)('HG-10: 자율 실행 행위를 requestHumanGate로 요청하면 BLOCKED된다', function () {
        var _a;
        var result = requestHumanGate({
            actor: 'HERMES_B',
            actionType: 'SIGNAL_COLLECT',
            rationale: '잘못된 요청',
        });
        (0, vitest_1.expect)(result.ok).toBe(false);
        (0, vitest_1.expect)((_a = result.error) === null || _a === void 0 ? void 0 : _a.code).toBe('INVALID_ACTION_CLASS');
        var row = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.auditId);
        (0, vitest_1.expect)(row.status).toBe('BLOCKED');
    });
    // -------------------------------------------------------------------------
    // Immutability: AuditLog는 수정·삭제 불가
    // -------------------------------------------------------------------------
    (0, vitest_1.it)('IMM-1: AuditLog 항목은 UPDATE가 불가능하다', function () {
        var entry = recordAudit({
            actor: 'HERMES_B',
            actionType: 'SIGNAL_COLLECT',
            executionClass: 'AUTONOMOUS',
            status: 'EXECUTED',
        });
        (0, vitest_1.expect)(function () {
            db.prepare("UPDATE audit_log SET status = 'BLOCKED' WHERE id = ?").run(entry.id);
        }).toThrow();
    });
    (0, vitest_1.it)('IMM-2: AuditLog 항목은 DELETE가 불가능하다', function () {
        var entry = recordAudit({
            actor: 'HERMES_B',
            actionType: 'SIGNAL_COLLECT',
            executionClass: 'AUTONOMOUS',
            status: 'EXECUTED',
        });
        (0, vitest_1.expect)(function () {
            db.prepare("DELETE FROM audit_log WHERE id = ?").run(entry.id);
        }).toThrow();
    });
    // -------------------------------------------------------------------------
    // Action classification correctness
    // -------------------------------------------------------------------------
    (0, vitest_1.it)('CLS-1: 모든 자율 실행 행위 유형이 AUTONOMOUS로 분류된다', function () {
        var autonomousTypes = [
            'SIGNAL_COLLECT', 'SIGNAL_SCORE', 'REPORT_GENERATE',
            'LOOP_HEARTBEAT', 'EXPERIMENT_DRAFT_CREATE', 'EXPERIMENT_HYPOTHESIS_ADVANCE',
        ];
        for (var _i = 0, autonomousTypes_1 = autonomousTypes; _i < autonomousTypes_1.length; _i++) {
            var t = autonomousTypes_1[_i];
            (0, vitest_1.expect)((0, types_1.classifyAction)(t)).toBe('AUTONOMOUS');
        }
    });
    (0, vitest_1.it)('CLS-2: 모든 Human Gate 행위 유형이 HUMAN_GATE_REQUIRED로 분류된다', function () {
        var gatedTypes = [
            'BUSINESS_CREATE', 'BUDGET_CHANGE', 'ORDER_PLACE', 'DELIVERY_ACCEPT', 'BUSINESS_TERMINATE',
            'EXPERIMENT_VALIDATE', 'EXPERIMENT_APPROVE', 'EXPERIMENT_RUN',
            'EXPERIMENT_SCALE', 'EXPERIMENT_PIVOT', 'EXPERIMENT_HOLD', 'EXPERIMENT_TERMINATE',
        ];
        for (var _i = 0, gatedTypes_1 = gatedTypes; _i < gatedTypes_1.length; _i++) {
            var t = gatedTypes_1[_i];
            (0, vitest_1.expect)((0, types_1.classifyAction)(t)).toBe('HUMAN_GATE_REQUIRED');
        }
    });
    (0, vitest_1.it)('CLS-3: AUTONOMOUS_ACTIONS과 HUMAN_GATE_ACTIONS은 서로 교집합이 없다', function () {
        var autonomousArr = __spreadArray([], types_1.AUTONOMOUS_ACTIONS, true);
        var gatedArr = __spreadArray([], types_1.HUMAN_GATE_ACTIONS, true);
        var intersection = autonomousArr.filter(function (a) { return gatedArr.includes(a); });
        (0, vitest_1.expect)(intersection).toHaveLength(0);
    });
    // -------------------------------------------------------------------------
    // Audit trail completeness: 연속 실행시 모두 기록됨
    // -------------------------------------------------------------------------
    (0, vitest_1.it)('TRAIL-1: 복수의 자율 실행이 연속으로 모두 AuditLog에 기록된다', function () {
        var actions = [
            'SIGNAL_COLLECT', 'SIGNAL_SCORE', 'REPORT_GENERATE',
        ];
        var auditIds = [];
        for (var _i = 0, actions_1 = actions; _i < actions_1.length; _i++) {
            var actionType = actions_1[_i];
            var result = executeAutonomous({ actor: 'HERMES_B', actionType: actionType }, function () { return undefined; });
            (0, vitest_1.expect)(result.ok).toBe(true);
            auditIds.push(result.auditId);
        }
        var rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at ASC').all();
        (0, vitest_1.expect)(rows.length).toBeGreaterThanOrEqual(3);
        var _loop_1 = function (id) {
            var found = rows.find(function (r) { return r.id === id; });
            (0, vitest_1.expect)(found).toBeDefined();
            (0, vitest_1.expect)(found === null || found === void 0 ? void 0 : found.status).toBe('EXECUTED');
        };
        for (var _a = 0, auditIds_1 = auditIds; _a < auditIds_1.length; _a++) {
            var id = auditIds_1[_a];
            _loop_1(id);
        }
    });
});

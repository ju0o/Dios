# DIOS Luna 단일 진실 공급원(SSOT)

문서 상태: Active Draft v1.0  
작성일: 2026-08-02  
상위 요구사항: [PRD-DIOS-LUNA.md](./PRD-DIOS-LUNA.md)

이 문서는 DIOS Luna의 제품 용어, 상태, 데이터 소유권, 안전 규칙, 구현 우선순위를 정의한다. 다른 문서나 화면 설명이 이 문서와 충돌하면 이 문서를 기준으로 정정한다.

## 1. 제품 한 문장

DIOS Luna는 비개발자가 사용자가 지정한 로컬 소스의 문서·메모리·스킬·워크플로·API 연동과 AI 운영 기록을 이해하고 안전하게 스캔, 검색, 검토, 승인하도록 돕는 로컬 우선 운영 콘솔이다.

## 2. 문서 권위

| 순위 | 문서/계약 | 역할 |
|---|---|---|
| 1 | SSOT | 용어, 상태, 불변 조건, 데이터 소유권 |
| 2 | PRD | 사용자 가치, 범위, 수용 기준, 로드맵 |
| 3 | 기술 설계서 | 모듈·DB·IPC의 구현 방식 |
| 4 | 화면 문서 | 구체적인 UX와 레이아웃 |
| 5 | 코드 주석 | 국소적인 구현 설명 |

코드는 SSOT를 구현해야 하며, 코드가 SSOT와 다르면 변경을 완료한 것으로 간주하지 않는다.

## 3. 정식 용어

| 용어 | 정식 의미 | 사용하지 말아야 할 표현 |
|---|---|---|
| Source | 사용자가 연결한 폴더 | Root, Folder를 화면마다 혼용 |
| Scan Job | 하나의 스캔 실행 단위 | 단순 Scan과 Job을 혼용 |
| Indexed File | 스캔 결과로 인덱스된 파일 | Document와 동일하게 사용 |
| Document | 프로젝트·업무 문서 도메인 레코드 | 모든 로컬 파일을 Document라고 부름 |
| Memory | patterns/projects/sessions/failures/success에 속한 운영 지식 | 캐시와 혼용 |
| Skill | `SKILL.md` 기반의 재사용 가능한 지침 | 일반 문서를 Skill로 표시 |
| Agent | 에이전트 정의와 실행 주체 정보 | 파일 하나를 곧 실행 중 Agent로 표시 |
| Human Gate | 사람 승인이 필요한 작업 경계 | 단순 확인 모달 |
| Audit Log | 변경 불가한 행위·상태 기록 | 일반 애플리케이션 로그 |
| Emergency Stop | 실행 중 작업을 중단하고 재개를 막는 상태 | 버튼 클릭 이벤트만 의미 |
| API Connection | 외부 서비스와 DIOS 사이의 승인된 연결 정보 | 사용자 승인 시 API 키도 로컬 SQLite에 저장 |
| Phase | 큰 목표를 묶은 제품 진행 단계 | 단순 날짜 구간 |
| Task | 사용자가 완료할 수 있는 구체적인 작업 | 추상적인 “개선” |
| 운영지침 | 작업을 안전하게 수행하는 순서형 안내 | 단순 참고 문서 |
| Roadmap | Phase와 목표의 시간·우선순위 구조 | 확정된 일정표로 오해 |
| Contextual Help | 현재 작업 화면에서 필요한 개념과 다음 행동을 설명하는 도움말 | 별도 암기용 사전 |
| 운영센터 | 운영지침·유지보수·서버·Agent 활용을 모아둔 공간 | 단순 문서 목록 |
| Runbook | 서버나 시스템 작업을 안전하게 수행하는 순서형 지침 | 막연한 운영 메모 |
| Maintenance | 만든 기능을 계속 정상 상태로 유지하는 활동 | 기능 개발과 동일하게 취급 |
| Agent Playbook | Agent의 역할·입력·결과·권한·사용 시점을 정리한 안내 | Agent 이름 목록 |
| Environment | 로컬·개발·테스트·운영 등 실행 환경 | 서버와 항상 동일하게 취급 |
| Translation Layer | 원본을 수정하지 않고 앱 안에서 보여주는 사용자 번역 | 원본 Markdown 덮어쓰기 |

## 4. 핵심 불변 조건

1. 원본 파일은 스캔만으로 변경하지 않는다.
2. 사용자가 선택하지 않은 경로를 자동으로 스캔하지 않는다.
3. 모든 내부 상대 경로는 `/`로 정규화한다.
4. 설정·소스·스캔 이력·감사 로그는 재시작 후에도 복원되어야 한다.
5. `PENDING_APPROVAL` 작업은 승인 전 실행되지 않는다.
6. Human Gate 요청은 정확히 한 번만 승인 또는 거부될 수 있다.
7. 감사 로그는 생성 후 수정·삭제하지 않는다.
8. 월간 리셋은 집계만 초기화하며 과거 사용 이력을 삭제하지 않는다.
9. Markdown/HTML 원문은 신뢰하지 않는다.
10. 비상 정지 후에는 명시적 재개 전까지 자동 작업을 시작하지 않는다.
11. 화면에 “저장 완료”, “승인 완료”, “중단 완료”를 표시하기 전에 실제 저장·상태 전환이 성공해야 한다.
12. 테스트가 private mock만 통과한 경우 통합 완료로 표시하지 않는다.
13. 기본 화면은 비개발자가 이해할 수 있는 한국어를 사용하고, 원래 용어는 괄호로 병기한다.
14. 어떤 API가 연결되어 있는지와 어디에 사용되는지는 표시하며, API 키는 기본 마스킹 후 사용자가 로컬 화면에서 공개할 수 있다.
15. 사용자가 이해하지 못한 개념을 발견하면 현재 화면 안에서 설명·예시·다음 행동으로 이동할 수 있어야 한다.
16. 사용자 번역은 원본 파일과 분리하고 원본 해시와 연결한다.
17. 운영지침은 실제 시스템 상태·환경·완료 증거와 연결되어야 한다.
18. Agent는 역할과 권한이 정의되지 않은 상태로 실행하지 않는다.

## 5. 정식 상태 모델

### 5.1 Scan Job

```text
queued → running → completed
                 ↘ failed
                 ↘ cancelled
```

- `queued`: 요청은 받았으나 아직 실행하지 않음
- `running`: 파일을 처리 중
- `completed`: 정상 종료
- `failed`: 일부 또는 전체 실행 실패
- `cancelled`: 사용자의 취소 또는 Emergency Stop으로 중단

`cancelled`는 `completed`로 변경할 수 없다. 재실행은 새 Scan Job을 생성한다.

### 5.2 Human Gate

```text
requested → pending_approval → approved
                             ↘ rejected
                             ↘ expired
```

한 요청에는 최대 하나의 terminal 상태만 존재한다. 승인·거부 처리 시 원본 요청 ID를 참조하는 해결 레코드를 추가하고, 같은 요청의 현재 상태를 다시 확인해 중복 처리를 거부한다.

### 5.3 Emergency Stop

```text
armed → stopping → stopped
                    ↓
                 resumed
```

- `armed`: 작업 실행 가능
- `stopping`: Abort 신호와 IPC 이벤트를 전파 중
- `stopped`: 새 자동 작업 차단
- `resumed`: 사용자가 명시적으로 재개

취소 가능한 UI 카운트다운과 실제 작업 취소는 하나의 취소 계약으로 연결한다. 타이머만 멈추고 작업은 계속되는 상태를 허용하지 않는다.

## 6. 데이터 소유권

| 데이터 | 정본 | 렌더러 책임 | 비고 |
|---|---|---|---|
| 연결 Source | SQLite `sources` | 조회·입력 표시 | localStorage는 임시 캐시로만 사용 |
| Scan Job | SQLite `scan_jobs` | 진행률 표시 | 취소·실패 원인 포함 |
| Indexed File | SQLite 인덱스 | 필터·선택 상태 | 원본은 로컬 파일 |
| 설정 | SQLite `settings` | 편집 폼 | 버전과 마이그레이션 필요 |
| AI 리소스 | SQLite `ai_resources` | 조회·명령 요청 | 한도 검증은 메인 프로세스 |
| 사용량 이력 | SQLite `usage_history` | 조회 | 월간 집계와 이력 분리 |
| Human Gate | SQLite `human_gate_events` | 요청·해결 표시 | 중복 해결 금지 |
| Audit Log | SQLite `audit_log` | 읽기 전용 표시 | 수정·삭제 금지 |
| 즐겨찾기·개인 UI | SQLite 또는 버전 설정 | 로컬 UI 변경 | 제품 상태와 혼용 금지 |
| API 연결 정보 | SQLite `api_connections` | 연결 목록·상태·사용량·비용 표시 | 로컬 전용 사용 원칙 |
| API 키·토큰 | SQLite `api_connections.api_key` | 사용자 승인 시 입력·수정·삭제 | 외부 DIOS 서버로 전송하지 않음 |
| 문맥형 도움말 | 운영지침·Task·화면 메타데이터 | 필요한 순간에 표시 | 별도 사전 메뉴로 분리하지 않음 |
| 로드맵·Phase·Task | SQLite `roadmap_*` | 진행률·다음 Task 표시 | 운영지침·증거와 연결 |
| 운영지침 | Markdown 원본 + 실행 메타데이터 | 단계 실행·체크 표시 | 원본과 실행 기록 분리 |
| 사용자 번역 | SQLite `translations` 또는 별도 앱 데이터 | 원문/번역 전환 | 원본 파일을 수정하지 않음 |
| 서버·환경 목록 | SQLite `environments`, `service_endpoints` | 상태·위치·운영지침 표시 | 비밀값은 저장하지 않음 |
| Agent Playbook | Markdown 원본 + 실행 메타데이터 | Agent 선택·호출 안내 | 권한·입력·결과 계약 포함 |

## 7. 저장소 계약

최소한 다음 테이블 또는 동등한 스키마가 존재해야 한다.

- `sources`: `id`, `path`, `label`, `enabled`, `include_patterns`, `exclude_patterns`, `created_at`, `updated_at`
- `scan_jobs`: `id`, `state`, `source_ids`, `started_at`, `finished_at`, `completed_count`, `total_count`, `error_count`, `cancel_reason`
- `indexed_files`: `id`, `source_id`, `path`, `rel_path`, `hash`, `kind`, `frontmatter_json`, `content`, `mtime`, `scanned_at`
- `settings`: `key`, `value_json`, `version`, `updated_at`
- `audit_log`: `id`, `request_id`, `actor`, `action_type`, `execution_class`, `status`, `payload_json`, `rationale`, `created_at`
- `api_connections`: `id`, `name`, `provider`, `purpose`, `endpoint`, `api_key`, `status`, `usage_amount`, `usage_unit`, `estimated_cost`, `last_checked_at`, `created_at`, `updated_at`
- `roadmap_phases`: `id`, `name`, `goal`, `state`, `sequence`, `start_at`, `target_at`
- `roadmap_tasks`: `id`, `phase_id`, `title`, `plain_language`, `state`, `priority`, `acceptance_criteria`, `evidence_path`
- `translations`: `id`, `source_path`, `source_hash`, `language`, `status`, `title`, `content`, `created_at`, `updated_at`
- `environments`: `id`, `name`, `kind`, `purpose`, `status`, `location`, `last_checked_at`, `runbook_path`, `backup_status`
- `service_endpoints`: `id`, `environment_id`, `name`, `provider`, `endpoint_label`, `health_status`, `last_checked_at`, `connection_ref`

날짜와 시간은 저장 시 Unix milliseconds를 사용하고, 화면 포맷팅은 렌더러에서 수행한다. 상대 경로는 `/`를 사용한다.

## 8. IPC 계약

모든 메인 프로세스 핸들러는 다음 규격을 따른다.

```ts
interface RequestContext {
  requestId: string
  actor: string
}

type IpcResult<T> =
  | { ok: true; data: T; requestId: string }
  | {
      ok: false
      error: { code: string; message: string; details?: unknown }
      requestId: string
    }
```

필수 IPC 영역:

- `source:list`, `source:add`, `source:update`, `source:remove`
- `scan:start`, `scan:cancel`, `scan:get`, `scan:list`
- `file:search`, `file:getPreview`, `file:getMetadata`
- `settings:get`, `settings:update`
- `humanGate:request`, `humanGate:resolve`, `humanGate:list`
- `audit:list`, `audit:get`
- `emergency:stop`, `emergency:resume`, `emergency:status`

렌더러는 `window as any`에 의존하지 않고 preload에서 타입이 선언된 API를 사용한다.

### 8.1 API 연동 계약

API 연동은 “컴퓨터 전체 권한”이 아니라 특정 서비스의 특정 기능에 대한 제한된 연결이다.

- `api_connections`에는 서비스 설명·목적·엔드포인트·상태·사용량·비용을 저장한다.
- 사용자가 로컬 전용 저장을 승인한 경우 API 키도 SQLite에 저장할 수 있다.
- API 키가 포함된 백업은 보호된 로컬 파일로 취급하며, 외부 공유 금지 안내를 표시한다.
- 연결 테스트와 사용량 조회는 등록된 엔드포인트로만 수행한다.
- Luna 또는 외부 AI가 호출할 수 있는 기능은 `scan`, `search`, `translation:get`, `translation:save`, `connection:health`처럼 명시적으로 선언한다.
- 임의 쉘 실행, 임의 파일 접근, 임의 URL 호출을 하나의 범용 API로 제공하지 않는다.

## 9. 보안 규칙

- `contextIsolation: true`, `nodeIntegration: false`를 유지한다.
- preload는 최소 API만 노출한다.
- 임의 경로 삭제 API는 source 등록 범위와 사용자 확인을 검증한다.
- Markdown은 DOMPurify 또는 동등한 허용 목록 기반 정제를 거친다.
- HTML 미리보기는 별도 sandbox와 CSP를 사용한다.
- 외부 URL·이미지·링크는 기본 차단 또는 사용자 확인을 거친다.
- 감사 로그에는 비밀 키·토큰·전체 문서 원문을 저장하지 않는다.
- AI 전송이 발생하면 전송 대상, 필드, 제공자, 비용을 사용자에게 표시한다.

### 9.1 비개발자 경험 규칙

- 최초 표기: `작업 단계(Phase)`, `해야 할 일(Task)`, `운영 방법(Workflow)`, `재사용 지침(Skill)`처럼 표기한다.
- 별도 용어사전을 강제하지 않고 현재 화면의 도움말 패널에 쉬운 정의, 실제 예시, 현재 프로젝트에서의 위치, 다음 행동을 표시한다.
- 빈 화면은 “데이터가 없습니다”로 끝내지 않고 “무엇을 추가하면 되는지”를 안내한다.
- 고급 용어와 내부 ID는 기본 화면에서 숨기고 “상세 정보”에서만 보여준다.
- 사용자가 진행할 다음 행동은 화면마다 하나를 기본 추천한다.

### 9.2 운영·유지보수 경험 규칙

- 모든 중요한 기능에는 “만든 뒤 계속 관리하는 방법”이 연결되어야 한다.
- 유지보수 화면은 주기, 확인 항목, 정상 기준, 실패 기준, 복구 행동을 보여준다.
- 서버를 보여줄 때는 서버 이름보다 목적과 현재 영향부터 설명한다.
- 서버 조작 버튼은 기본 숨김 또는 승인 대상으로 두고, 먼저 Runbook을 보여준다.
- Agent 화면은 이름보다 역할과 사용 시나리오를 먼저 보여준다.

## 10. UX 정본

### 홈 화면의 정본 카드

- 연결된 Source 수
- 마지막 스캔 상태
- 새로 변경된 파일 수
- 오류·누락·중복 수
- 승인 대기 수
- 현재 비용 경고
- “다음 행동” 하나
- 서버·환경 상태
- 유지보수 예정 항목
- 현재 Task에 추천되는 Agent

### 비개발자 홈 화면의 정본 영역

- 지금 하고 있는 일
- 현재 Phase와 목표
- 다음 Task 하나
- 최근 변경된 파일
- 번역이 필요한 Skill
- 연결된 API와 상태
- 문제가 있는 항목과 복구 버튼

### 정식 개념 관계

```text
로드맵
  └─ Phase
      └─ 목표
          └─ Task
              ├─ 운영지침
              ├─ 관련 문서
              └─ 완료 증거
```

문서·Skill·Memory는 Task와 운영지침을 설명하는 지식 자원이며, Task 그 자체와 동일하지 않다.

### 상태 색상

- 회색: 준비/비활성
- 파랑: 실행/정보
- 초록: 정상/완료/승인
- 노랑: 경고/검토 필요
- 빨강: 실패/정지/거부

색상만으로 의미를 전달하지 않고 항상 텍스트 상태를 함께 표시한다.

### 실패 화면

모든 실패는 다음 네 요소를 포함한다.

1. 무엇이 실패했는가
2. 사용자에게 어떤 영향이 있는가
3. 지금 할 수 있는 복구 행동
4. 기술 세부 정보 보기

## 11. 구현 우선순위

### P0: 출시 차단

- 실제 DB 스키마와 도메인 코드 일치
- 감사 로그 생성
- 안전한 콘텐츠 렌더링
- 비상 정지와 취소
- IPC 타입 계약
- Windows 경로 정규화
- 설정·Source 복원
- API 연동 정보와 키를 로컬 SQLite에 함께 저장할 수 있으며, 백업 공유 경고를 유지한다.

### P1: 일상 사용성

- Dashboard와 모든 핵심 화면 연결
- 검색·트리 필터 완성
- 스캔 이력·오류 복구
- 문서 상세 미리보기
- 메모리·스킬·에이전트 분류 품질
- 운영센터와 문맥형 도움말
- Phase·Task·운영지침 화면
- API 연결 현황 화면
- 유지보수·서버 운영 화면
- Agent Playbook 화면

### P2: 지능화

- 관계 그래프
- 중복·고아·충돌 추천
- AI 요약·분류 제안
- 비용·실험·결정 운영 패널 고도화

## 12. 품질 증거 규칙

다음 증거를 구분한다.

- 정적 증거: typecheck, lint, diff 검토
- 단위 증거: 순수 함수·상태 전이 테스트
- 통합 증거: 실제 SQLite 스키마·IPC·preload 테스트
- UI 증거: 실제 Electron 화면에서 클릭 흐름 확인
- 운영 증거: 취소, 재시작, 실패 복구, 새 설치 검증

단위 테스트만 통과한 경우 “기능 구현 완료”가 아니라 “단위 검증 완료”로 기록한다.

## 13. 변경 관리

SSOT를 바꾸려면 다음을 함께 갱신한다.

1. 이 문서의 해당 계약
2. PRD의 해당 요구사항 또는 로드맵
3. 관련 DB/IPC 타입
4. 테스트와 수용 기준
5. 변경 이유와 영향 범위

다음 항목은 제품 책임자의 명시적 승인 없이 변경하지 않는다.

- Human Gate 대상 행위
- Emergency Stop 의미
- 원본 파일 보존 원칙
- 외부 AI 전송 기본값
- 감사 로그 불변성

## 14. 현재 기준 결정

| 결정 | 상태 | 이유 |
|---|---|---|
| 로컬 우선 Electron 앱으로 유지 | 확정 | 원본 문서와 개인 메모리의 통제권 보장 |
| React 렌더러와 SQLite 메인 저장소 분리 | 확정 | UI와 데이터 정본 분리 |
| 먼저 신뢰성 기반을 완성한 뒤 AI 지능화 진행 | 확정 | 불안정한 자동화는 제품 신뢰를 훼손 |
| 파일 삭제·외부 전송은 기본 자동화하지 않음 | 확정 | 안전한 기본값 |
| 화면은 상태·다음 행동 중심으로 구성 | 확정 | 텍스트 중심 탐색의 인지 부담 감소 |
| DIOS는 비개발자용 개념 번역기를 포함 | 확정 | md·Skill·Workflow·Memory·API·Phase·Task가 생소한 사용자를 위한 핵심 가치 |
| 원본 Markdown과 사용자 번역은 분리 | 확정 | 원본 손상 없이 읽기 경험 개선 |
| API는 허용 목록 기반의 제한된 연동만 제공 | 확정 | 컴퓨터 전체 제어와 임의 실행을 방지 |
| API 키는 사용자 승인 시 로컬 SQLite에 보관 | 확정 | 로컬 전용 운영과 사용 편의성 |
| 별도 용어사전 대신 문맥형 도움말 제공 | 확정 | 사용자가 필요한 순간에만 배우도록 함 |
| 운영지침은 개발 이후 유지보수까지 포함 | 확정 | 만든 뒤 관리하지 못하는 문제를 방지 |
| Agent는 Playbook과 권한 계약을 가진다 | 확정 | Agent를 목적 없이 호출하는 문제를 방지 |

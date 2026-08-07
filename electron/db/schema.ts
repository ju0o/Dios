import Database from 'better-sqlite3'

let dbInstance: Database.Database | null = null

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  dbInstance = db

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')

  // Create tables
  db.exec(`
    -- Projects
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    -- Documents
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      type TEXT DEFAULT 'markdown',
      file_path TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Experiments (상태 기계)
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      state TEXT DEFAULT 'DRAFT',
      created_by TEXT NOT NULL,
      approved_by TEXT,
      approved_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    -- Experiment transitions (상태 전이 기록)
    CREATE TABLE IF NOT EXISTS experiment_transitions (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      role TEXT NOT NULL,
      rationale TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
    );

    -- Decision Ledger (블록체인 스타일 의사결정 기록)
    CREATE TABLE IF NOT EXISTS decision_ledger (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      options TEXT NOT NULL,
      chosen_option TEXT NOT NULL,
      rationale TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      previous_entry_hash TEXT,
      entry_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    -- Human Gate Config (게이트 설정)
    CREATE TABLE IF NOT EXISTS human_gate_config (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      soft_threshold REAL NOT NULL,
      hard_threshold REAL NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    -- Human Gate Events (게이트 이벤트 기록)
    CREATE TABLE IF NOT EXISTS human_gate_events (
      id TEXT PRIMARY KEY,
      gate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      approved INTEGER,
      approved_by TEXT,
      approved_at INTEGER,
      rationale TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (gate_id) REFERENCES human_gate_config(id) ON DELETE CASCADE
    );

    -- AI Resources (비용 관리)
    CREATE TABLE IF NOT EXISTS ai_resources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      monthly_cap REAL NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'normal',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    -- AI Resource Usage History (사용량 기록)
    CREATE TABLE IF NOT EXISTS usage_history (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      cost REAL NOT NULL,
      description TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (resource_id) REFERENCES ai_resources(id) ON DELETE CASCADE
    );

    -- App settings (DIOS 운영 설정)
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Integration registry (비밀키를 저장하지 않는 연동 목록)
    CREATE TABLE IF NOT EXISTS api_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      endpoint TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '확인 필요',
      usage_amount REAL NOT NULL DEFAULT 0,
      usage_unit TEXT NOT NULL DEFAULT 'requests',
      estimated_cost REAL NOT NULL DEFAULT 0,
      last_checked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Roadmap / Phase / Task
    CREATE TABLE IF NOT EXISTS roadmap_phases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roadmap_tasks (
      id TEXT PRIMARY KEY,
      phase_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (phase_id) REFERENCES roadmap_phases(id) ON DELETE CASCADE
    );

    -- Maintenance checklist
    CREATE TABLE IF NOT EXISTS maintenance_checks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      done INTEGER NOT NULL DEFAULT 0,
      checked_at INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    -- Agent task requests
    CREATE TABLE IF NOT EXISTS task_requests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      reference_text TEXT NOT NULL DEFAULT '',
      acceptance TEXT NOT NULL DEFAULT '',
      forbidden TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Project-specific operating guidance
    CREATE TABLE IF NOT EXISTS project_runbooks (
      project_id TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Project-specific folders, Skills, and Memory roots
    CREATE TABLE IF NOT EXISTS project_connections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, kind, path),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Local activity timeline
    CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    -- Agent Monitor Services (구독 AI 서비스 목록)
    CREATE TABLE IF NOT EXISTS agent_services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      monthly_cap REAL NOT NULL DEFAULT 0,
      reset_day INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Agent Usage Cache (API 조회 결과 캐시)
    CREATE TABLE IF NOT EXISTS agent_usage_cache (
      service_id TEXT PRIMARY KEY,
      used REAL NOT NULL DEFAULT 0,
      limit_amount REAL NOT NULL DEFAULT 0,
      remaining REAL NOT NULL DEFAULT 0,
      percent REAL NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'idle',
      error TEXT NOT NULL DEFAULT '',
      daily REAL NOT NULL DEFAULT 0,
      weekly REAL NOT NULL DEFAULT 0,
      monthly REAL NOT NULL DEFAULT 0,
      fetched_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (service_id) REFERENCES agent_services(id) ON DELETE CASCADE
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_experiments_state ON experiments(state);
    CREATE INDEX IF NOT EXISTS idx_transitions_experiment ON experiment_transitions(experiment_id);
    CREATE INDEX IF NOT EXISTS idx_decision_ledger_created ON decision_ledger(created_at);
    CREATE INDEX IF NOT EXISTS idx_gate_events_gate ON human_gate_events(gate_id);
    CREATE INDEX IF NOT EXISTS idx_gate_events_pending ON human_gate_events(approved) WHERE approved IS NULL;
    CREATE INDEX IF NOT EXISTS idx_usage_resource ON usage_history(resource_id);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_roadmap_tasks_phase ON roadmap_tasks(phase_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_project_connections_project ON project_connections(project_id, kind);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_service ON agent_usage_cache(service_id);
  `)

  // Existing local databases need these columns added without losing data.
  const connectionColumns = new Set(
    (db.prepare('PRAGMA table_info(api_connections)').all() as Array<{ name: string }>).map((column) => column.name)
  )
  const migrations: Array<[string, string]> = [
    ['purpose', "ALTER TABLE api_connections ADD COLUMN purpose TEXT NOT NULL DEFAULT ''"],
    ['api_key', "ALTER TABLE api_connections ADD COLUMN api_key TEXT NOT NULL DEFAULT ''"],
    ['usage_amount', "ALTER TABLE api_connections ADD COLUMN usage_amount REAL NOT NULL DEFAULT 0"],
    ['usage_unit', "ALTER TABLE api_connections ADD COLUMN usage_unit TEXT NOT NULL DEFAULT 'requests'"],
    ['estimated_cost', "ALTER TABLE api_connections ADD COLUMN estimated_cost REAL NOT NULL DEFAULT 0"],
  ]
  for (const [column, statement] of migrations) {
    if (!connectionColumns.has(column)) db.exec(statement)
  }

  return db
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return dbInstance
}

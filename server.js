const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const dataDir = path.join(root, 'data');
const runtimeDataDir = process.env.VERCEL ? path.join(os.tmpdir(), 'org-jd-structure') : dataDir;
const dbPath = process.env.ORG_PORTAL_DB_PATH
  ? path.resolve(process.env.ORG_PORTAL_DB_PATH)
  : path.join(runtimeDataDir, 'org-portal.sqlite');
const samplePath = path.join(dataDir, 'sample-org-data.json');
const port = Number(process.env.PORT) || 5173;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

const rolePermissions = {
  employee: new Set(['org:read', 'jd:print']),
  admin: new Set(['org:read', 'jd:print', 'position:write', 'position:import', 'position:reset', 'approval:review', 'audit:read'])
};

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
initializeDatabase();
seedDatabase();
cleanupExpiredSessions();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: 'Internal server error' });
  }
});

server.listen(port, () => {
  console.log(`Org Structure & JD Portal running at http://localhost:${port}`);
  console.log('Demo users: admin/admin123, employee/employee123');
});

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('employee','admin')),
      display_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES positions(id) ON DELETE SET NULL,
      nama_jabatan TEXT NOT NULL,
      departemen TEXT NOT NULL,
      job_code TEXT NOT NULL,
      grade TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','draft','inactive','obsolete')),
      location TEXT NOT NULL,
      cost_center TEXT NOT NULL,
      approved_headcount INTEGER NOT NULL DEFAULT 1,
      effective_date TEXT NOT NULL,
      effective_end_date TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_descriptions (
      position_id TEXT PRIMARY KEY REFERENCES positions(id) ON DELETE CASCADE,
      ringkasan TEXT NOT NULL DEFAULT '',
      tugas_json TEXT NOT NULL DEFAULT '[]',
      wewenang_json TEXT NOT NULL DEFAULT '[]',
      kualifikasi_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS document_controls (
      position_id TEXT PRIMARY KEY REFERENCES positions(id) ON DELETE CASCADE,
      document_no TEXT NOT NULL,
      revision TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      review_date TEXT,
      prepared_by TEXT,
      reviewed_by TEXT,
      approved_by TEXT,
      approval_status TEXT NOT NULL CHECK(approval_status IN ('draft','reviewed','approved','obsolete')),
      change_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS employee_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      employee_id TEXT,
      employee_name TEXT,
      assignment_status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT,
      end_date TEXT
    );

    CREATE TABLE IF NOT EXISTS movement_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      movement_type TEXT,
      employee_id TEXT,
      employee_name TEXT,
      from_position_id TEXT,
      to_position_id TEXT,
      effective_date TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS position_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id TEXT NOT NULL,
      version_no INTEGER NOT NULL,
      effective_date TEXT NOT NULL,
      effective_end_date TEXT,
      snapshot_json TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(position_id, version_no)
    );

    CREATE TABLE IF NOT EXISTS approval_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','submitted','approved','rejected','obsolete')),
      submitted_by INTEGER REFERENCES users(id),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      before_json TEXT,
      after_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedDatabase() {
  ensureUser('employee', 'employee123', 'employee', 'Demo Employee');
  ensureUser('admin', 'admin123', 'admin', 'Demo Admin');
  const existing = db.prepare('SELECT COUNT(*) AS count FROM positions').get().count;
  if (existing > 0) return;
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  replaceAllOrgData(sample, null, 'seed_default_data', null);
}

function ensureUser(username, password, role, displayName) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return;
  const { hash, salt } = hashPassword(password);
  db.prepare('INSERT INTO users (username, password_hash, salt, role, display_name) VALUES (?, ?, ?, ?, ?)')
    .run(username, hash, salt, role, displayName);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.password_hash, 'hex'));
}

async function handleApi(request, response, url) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, null);
    return;
  }

  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /api/health') return sendJson(response, 200, { ok: true, database: 'sqlite', time: new Date().toISOString() });
  if (route === 'POST /api/auth/login') return login(request, response);

  const session = authenticate(request);
  if (!session) return sendJson(response, 401, { error: 'Authentication required' });

  if (route === 'POST /api/auth/logout') return logout(request, response, session);
  if (route === 'GET /api/me') return sendJson(response, 200, publicUser(session.user));
  if (route === 'GET /api/org-data') return requirePermission(response, session, 'org:read', () => sendJson(response, 200, url.searchParams.get('as_of') ? getOrgDataAsOf(url.searchParams.get('as_of')) : getOrgData()));
  if (route === 'PUT /api/org-data') return requirePermission(response, session, 'position:write', () => saveOrgData(request, response, session, false));
  if (route === 'POST /api/org-data/import') return requirePermission(response, session, 'position:import', () => saveOrgData(request, response, session, true));
  if (route === 'POST /api/org-data/reset') return requirePermission(response, session, 'position:reset', () => resetOrgData(response, session, request));
  if (route === 'POST /api/positions') return requirePermission(response, session, 'position:write', () => createPosition(request, response, session));
  const positionRoute = url.pathname.match(/^\/api\/positions\/([^/]+)(?:\/(reporting-line|status))?$/);
  const positionActionRoute = url.pathname.match(/^\/api\/positions\/([^/]+)\/(versions|submit|draft-revision)$/);
  const positionVersionRoute = url.pathname.match(/^\/api\/positions\/([^/]+)\/versions\/([^/]+)(?:\/(restore))?$/);
  if (positionRoute && request.method === 'PUT' && !positionRoute[2]) return requirePermission(response, session, 'position:write', () => updatePosition(request, response, session, decodeURIComponent(positionRoute[1])));
  if (positionRoute && request.method === 'PATCH' && positionRoute[2] === 'reporting-line') return requirePermission(response, session, 'position:write', () => updateReportingLine(request, response, session, decodeURIComponent(positionRoute[1])));
  if (positionRoute && request.method === 'PATCH' && positionRoute[2] === 'status') return requirePermission(response, session, 'position:write', () => updatePositionStatus(request, response, session, decodeURIComponent(positionRoute[1])));
  if (positionActionRoute && request.method === 'GET' && positionActionRoute[2] === 'versions') return requirePermission(response, session, 'org:read', () => sendJson(response, 200, getPositionVersions(decodeURIComponent(positionActionRoute[1]))));
  if (positionActionRoute && request.method === 'POST' && positionActionRoute[2] === 'submit') return requirePermission(response, session, 'position:write', () => submitPositionForApproval(request, response, session, decodeURIComponent(positionActionRoute[1])));
  if (positionActionRoute && request.method === 'POST' && positionActionRoute[2] === 'draft-revision') return requirePermission(response, session, 'position:write', () => createDraftRevision(request, response, session, decodeURIComponent(positionActionRoute[1])));
  if (positionVersionRoute && request.method === 'GET' && positionVersionRoute[2] === 'compare') return requirePermission(response, session, 'org:read', () => comparePositionVersions(response, decodeURIComponent(positionVersionRoute[1]), url.searchParams));
  if (positionVersionRoute && request.method === 'POST' && positionVersionRoute[3] === 'restore') return requirePermission(response, session, 'position:write', () => restoreVersionAsDraft(request, response, session, decodeURIComponent(positionVersionRoute[1]), Number(positionVersionRoute[2])));
  if (route === 'GET /api/audit-logs') return requirePermission(response, session, 'audit:read', () => sendJson(response, 200, getAuditLogs()));
  if (route === 'GET /api/approvals') return requirePermission(response, session, 'audit:read', () => sendJson(response, 200, getApprovals()));
  if (route === 'POST /api/approvals/review') return requirePermission(response, session, 'approval:review', () => reviewApproval(request, response, session));

  sendJson(response, 404, { error: 'API route not found' });
}

async function login(request, response) {
  const body = await readJsonBody(request);
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(body.username || '').trim());
  if (!user || !verifyPassword(body.password || '', user)) {
    sendJson(response, 401, { error: 'Invalid username or password' });
    return;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, user.id, expiresAt);
  writeAudit(user.id, 'login', 'user', String(user.id), null, publicUser(user), getIp(request));
  sendJson(response, 200, { token, expires_at: expiresAt, user: publicUser(user) });
}

function logout(request, response, session) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.tokenHash);
  writeAudit(session.user.id, 'logout', 'user', String(session.user.id), null, publicUser(session.user), getIp(request));
  sendJson(response, 200, { ok: true });
}

function authenticate(request) {
  const header = request.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const tokenHash = hashToken(match[1]);
  const row = db.prepare(`
    SELECT s.token_hash, s.expires_at, u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1
  `).get(tokenHash);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { tokenHash, user: row };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function requirePermission(response, session, permission, handler) {
  if (!rolePermissions[session.user.role]?.has(permission)) {
    sendJson(response, 403, { error: 'Forbidden for current role' });
    return;
  }
  return handler();
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, display_name: user.display_name };
}

async function saveOrgData(request, response, session, isImport) {
  const body = await readJsonBody(request);
  const positions = Array.isArray(body) ? body : body.positions;
  if (!Array.isArray(positions)) return sendJson(response, 400, { error: 'positions must be an array' });
  const normalized = normalizeData(positions);
  const errors = validateStructure(normalized);
  if (errors.length) return sendJson(response, 400, { error: errors[0], errors });
  const before = getOrgData();
  replaceAllOrgData(normalized, session.user.id, isImport ? 'import_org_data' : 'save_org_data', getIp(request));
  const after = getOrgData();
  sendJson(response, 200, { ok: true, positions: after, changed: JSON.stringify(before) !== JSON.stringify(after) });
}

async function createPosition(request, response, session) {
  const body = await readJsonBody(request);
  const item = normalizePositionPayload(body);
  if (!item) return sendJson(response, 400, { error: 'position payload is required' });
  if (item.document_control.approval_status === 'approved') return sendJson(response, 400, { error: 'Use approval review to approve a JD' });
  if (getPosition(item.id)) return sendJson(response, 409, { error: 'Position ID already exists' });
  const candidate = [...getOrgData(), item];
  const errors = validateStructure(candidate);
  if (errors.length) return sendJson(response, 400, { error: errors[0], errors });
  saveSinglePosition(item, null, session.user.id, 'create_position', getIp(request));
  sendJson(response, 201, { ok: true, position: getPosition(item.id), positions: getOrgData() });
}

async function updatePosition(request, response, session, positionId) {
  const existing = getPosition(positionId);
  if (!existing) return sendJson(response, 404, { error: 'Position not found' });
  if (isApprovedLocked(existing)) return sendJson(response, 409, { error: 'Approved JD is locked. Create a draft revision before editing.' });
  const body = await readJsonBody(request);
  const raw = body.position || body;
  if (raw.id && String(raw.id).trim() !== positionId) return sendJson(response, 400, { error: 'Position ID cannot be changed' });
  const item = normalizePositionPayload({ ...raw, id: positionId });
  if (!item) return sendJson(response, 400, { error: 'position payload is required' });
  if (item.document_control.approval_status === 'approved') return sendJson(response, 400, { error: 'Use approval review to approve a JD' });
  const candidate = getOrgData().map(position => position.id === positionId ? item : position);
  const errors = validateStructure(candidate);
  if (errors.length) return sendJson(response, 400, { error: errors[0], errors });
  saveSinglePosition(item, existing, session.user.id, 'update_position', getIp(request));
  sendJson(response, 200, { ok: true, position: getPosition(positionId), positions: getOrgData() });
}

async function submitPositionForApproval(request, response, session, positionId) {
  const existing = getPosition(positionId);
  if (!existing) return sendJson(response, 404, { error: 'Position not found' });
  if (existing.document_control.approval_status === 'approved') return sendJson(response, 409, { error: 'Approved JD is already locked. Create a draft revision for new changes.' });
  const open = db.prepare("SELECT id FROM approval_workflows WHERE entity_type = 'position' AND entity_id = ? AND status = 'submitted' ORDER BY id DESC LIMIT 1").get(positionId);
  if (open) return sendJson(response, 409, { error: 'Position already has a submitted approval workflow' });
  const body = await readJsonBody(request);
  const before = getPosition(positionId);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE document_controls SET approval_status = ?, reviewed_by = ?, change_notes = ? WHERE position_id = ?')
      .run('reviewed', before.document_control.reviewed_by || session.user.display_name, body.notes || before.document_control.change_notes || 'Submitted for approval.', positionId);
    createVersion(positionId, session.user.id, before.effective_date, before.effective_end_date || null, getPosition(positionId));
    createApproval(positionId, session.user.id, 'submitted', body.notes || `submit_for_approval: ${before.nama_jabatan}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  writeAudit(session.user.id, 'submit_position_approval', 'position', positionId, before, getPosition(positionId), getIp(request));
  sendJson(response, 200, { ok: true, position: getPosition(positionId), positions: getOrgData(), approvals: getApprovals() });
}

async function createDraftRevision(request, response, session, positionId) {
  const existing = getPosition(positionId);
  if (!existing) return sendJson(response, 404, { error: 'Position not found' });
  const body = await readJsonBody(request);
  const item = normalizePositionPayload({
    ...existing,
    updated_at: new Date().toISOString().slice(0, 10),
    document_control: {
      ...existing.document_control,
      revision: nextRevision(existing.document_control.revision),
      approval_status: 'draft',
      reviewed_by: '',
      approved_by: '',
      change_notes: body.notes || `Draft revision created from ${existing.document_control.revision || 'previous revision'}.`
    }
  });
  saveSinglePosition(item, existing, session.user.id, 'create_draft_revision', getIp(request), { approvalStatus: 'draft' });
  sendJson(response, 200, { ok: true, position: getPosition(positionId), positions: getOrgData(), approvals: getApprovals() });
}

function comparePositionVersions(response, positionId, searchParams) {
  const fromVersion = Number(searchParams.get('from'));
  const toVersion = Number(searchParams.get('to'));
  if (!Number.isInteger(fromVersion) || !Number.isInteger(toVersion)) return sendJson(response, 400, { error: 'from and to version numbers are required' });
  const from = getPositionVersionSnapshot(positionId, fromVersion);
  const to = getPositionVersionSnapshot(positionId, toVersion);
  if (!from || !to) return sendJson(response, 404, { error: 'Version snapshot not found' });
  sendJson(response, 200, {
    ok: true,
    position_id: positionId,
    from: { version_no: from.version_no, created_at: from.created_at, snapshot: from.snapshot },
    to: { version_no: to.version_no, created_at: to.created_at, snapshot: to.snapshot },
    changes: diffPositionSnapshots(from.snapshot, to.snapshot)
  });
}

async function restoreVersionAsDraft(request, response, session, positionId, versionNo) {
  const existing = getPosition(positionId);
  if (!existing) return sendJson(response, 404, { error: 'Position not found' });
  const version = getPositionVersionSnapshot(positionId, versionNo);
  if (!version) return sendJson(response, 404, { error: 'Version snapshot not found' });
  const body = await readJsonBody(request);
  const restored = normalizePositionPayload({
    ...version.snapshot,
    id: positionId,
    updated_at: new Date().toISOString().slice(0, 10),
    document_control: {
      ...version.snapshot.document_control,
      revision: nextRevision(existing.document_control.revision),
      approval_status: 'draft',
      reviewed_by: '',
      approved_by: '',
      change_notes: body.notes || `Restored version ${versionNo} as draft.`
    }
  });
  const candidate = getOrgData().map(position => position.id === positionId ? restored : position);
  const errors = validateStructure(candidate);
  if (errors.length) return sendJson(response, 400, { error: errors[0], errors });
  saveSinglePosition(restored, existing, session.user.id, 'restore_version_as_draft', getIp(request), { approvalStatus: 'draft' });
  sendJson(response, 200, { ok: true, position: getPosition(positionId), positions: getOrgData(), versions: getPositionVersions(positionId) });
}

async function updateReportingLine(request, response, session, positionId) {
  const existing = getPosition(positionId);
  if (!existing) return sendJson(response, 404, { error: 'Position not found' });
  const body = await readJsonBody(request);
  const item = normalizePositionPayload({ ...existing, parent_id: body.parent_id || null, updated_at: new Date().toISOString().slice(0, 10) });
  const candidate = getOrgData().map(position => position.id === positionId ? item : position);
  const errors = validateStructure(candidate);
  if (errors.length) return sendJson(response, 400, { error: errors[0], errors });
  saveSinglePosition(item, existing, session.user.id, 'change_reporting_line', getIp(request));
  sendJson(response, 200, { ok: true, position: getPosition(positionId), positions: getOrgData() });
}

async function updatePositionStatus(request, response, session, positionId) {
  const existing = getPosition(positionId);
  if (!existing) return sendJson(response, 404, { error: 'Position not found' });
  const body = await readJsonBody(request);
  const status = String(body.status || '').trim();
  if (!['active', 'draft', 'inactive', 'obsolete'].includes(status)) return sendJson(response, 400, { error: 'Invalid position status' });
  const item = normalizePositionPayload({ ...existing, status, updated_at: new Date().toISOString().slice(0, 10) });
  const candidate = getOrgData().map(position => position.id === positionId ? item : position);
  const errors = validateStructure(candidate);
  if (errors.length) return sendJson(response, 400, { error: errors[0], errors });
  saveSinglePosition(item, existing, session.user.id, 'change_position_status', getIp(request));
  sendJson(response, 200, { ok: true, position: getPosition(positionId), positions: getOrgData() });
}

function resetOrgData(response, session, request) {
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  replaceAllOrgData(normalizeData(sample), session.user.id, 'reset_org_data', getIp(request));
  sendJson(response, 200, { ok: true, positions: getOrgData() });
}

async function reviewApproval(request, response, session) {
  const body = await readJsonBody(request);
  const status = String(body.status || '').trim();
  if (!['approved', 'rejected', 'obsolete'].includes(status)) return sendJson(response, 400, { error: 'Invalid approval review status' });
  const id = Number(body.id);
  const existing = db.prepare('SELECT * FROM approval_workflows WHERE id = ?').get(id);
  if (!existing) return sendJson(response, 404, { error: 'Approval workflow not found' });
  const beforePosition = getPosition(existing.entity_id);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE approval_workflows SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, notes = ? WHERE id = ?')
      .run(status, session.user.id, body.notes || existing.notes || '', id);
    if (existing.entity_type === 'position' && beforePosition) {
      const dcStatus = status === 'approved' ? 'approved' : status === 'obsolete' ? 'obsolete' : 'draft';
      db.prepare('UPDATE document_controls SET approval_status = ?, reviewed_by = ?, approved_by = ?, change_notes = ? WHERE position_id = ?')
        .run(dcStatus, session.user.display_name, status === 'approved' ? session.user.display_name : '', body.notes || beforePosition.document_control.change_notes || '', existing.entity_id);
      createVersion(existing.entity_id, session.user.id, beforePosition.effective_date, beforePosition.effective_end_date || null, getPosition(existing.entity_id));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const approval = db.prepare('SELECT * FROM approval_workflows WHERE id = ?').get(id);
  writeAudit(session.user.id, 'review_approval', 'approval_workflow', String(id), existing, approval, getIp(request));
  if (beforePosition) writeAudit(session.user.id, `approval_${status}`, 'position', existing.entity_id, beforePosition, getPosition(existing.entity_id), getIp(request));
  sendJson(response, 200, { ok: true, approval, position: beforePosition ? getPosition(existing.entity_id) : null, positions: getOrgData() });
}

function replaceAllOrgData(items, actorUserId, action, ipAddress) {
  const before = getOrgData();
  db.exec('BEGIN');
  try {
    const positions = items;
    db.exec('DELETE FROM movement_history; DELETE FROM employee_assignments; DELETE FROM document_controls; DELETE FROM job_descriptions; DELETE FROM positions;');
    const insertPosition = db.prepare(`INSERT INTO positions (id, parent_id, nama_jabatan, departemen, job_code, grade, status, location, cost_center, approved_headcount, effective_date, effective_end_date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertJd = db.prepare(`INSERT INTO job_descriptions (position_id, ringkasan, tugas_json, wewenang_json, kualifikasi_json) VALUES (?, ?, ?, ?, ?)`);
    const insertDc = db.prepare(`INSERT INTO document_controls (position_id, document_no, revision, effective_date, review_date, prepared_by, reviewed_by, approved_by, approval_status, change_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertAssignment = db.prepare(`INSERT INTO employee_assignments (position_id, employee_id, employee_name, assignment_status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)`);
    const insertMovement = db.prepare(`INSERT INTO movement_history (position_id, movement_type, employee_id, employee_name, from_position_id, to_position_id, effective_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of positions) {
      insertPosition.run(item.id, null, item.nama_jabatan, item.departemen, item.job_code, item.grade, item.status, item.location, item.cost_center, item.approved_headcount, item.effective_date, item.effective_end_date || null, item.updated_at);
      insertJd.run(item.id, item.deskripsi_pekerjaan.ringkasan, JSON.stringify(item.deskripsi_pekerjaan.tugas), JSON.stringify(item.deskripsi_pekerjaan.wewenang), JSON.stringify(item.deskripsi_pekerjaan.kualifikasi));
      insertDc.run(item.id, item.document_control.document_no, item.document_control.revision, item.document_control.effective_date, item.document_control.review_date || null, item.document_control.prepared_by || '', item.document_control.reviewed_by || '', item.document_control.approved_by || '', item.document_control.approval_status, item.document_control.change_notes || '');
      for (const incumbent of item.incumbents || []) insertAssignment.run(item.id, incumbent.employee_id || '', incumbent.employee_name || '', incumbent.assignment_status || 'active', incumbent.start_date || '', incumbent.end_date || null);
      for (const movement of item.movement_history || []) insertMovement.run(item.id, movement.movement_type || '', movement.employee_id || '', movement.employee_name || '', movement.from_position_id || '', movement.to_position_id || item.id, movement.effective_date || '', movement.notes || '');
      createVersion(item.id, actorUserId, item.effective_date, item.effective_end_date || null, item);
      createApproval(item.id, actorUserId, action === 'seed_default_data' ? 'approved' : 'submitted', `${action}: ${item.nama_jabatan}`);
    }
    const updateParent = db.prepare('UPDATE positions SET parent_id = ? WHERE id = ?');
    for (const item of positions) updateParent.run(item.parent_id || null, item.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const after = getOrgData();
  writeAudit(actorUserId, action, 'org_data', null, before, after, ipAddress);
}

function saveSinglePosition(item, beforePosition, actorUserId, action, ipAddress, options = {}) {
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO positions (id, parent_id, nama_jabatan, departemen, job_code, grade, status, location, cost_center, approved_headcount, effective_date, effective_end_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        nama_jabatan = excluded.nama_jabatan,
        departemen = excluded.departemen,
        job_code = excluded.job_code,
        grade = excluded.grade,
        status = excluded.status,
        location = excluded.location,
        cost_center = excluded.cost_center,
        approved_headcount = excluded.approved_headcount,
        effective_date = excluded.effective_date,
        effective_end_date = excluded.effective_end_date,
        updated_at = excluded.updated_at
    `).run(item.id, item.parent_id || null, item.nama_jabatan, item.departemen, item.job_code, item.grade, item.status, item.location, item.cost_center, item.approved_headcount, item.effective_date, item.effective_end_date || null, item.updated_at);

    db.prepare('DELETE FROM movement_history WHERE position_id = ?').run(item.id);
    db.prepare('DELETE FROM employee_assignments WHERE position_id = ?').run(item.id);
    db.prepare('DELETE FROM document_controls WHERE position_id = ?').run(item.id);
    db.prepare('DELETE FROM job_descriptions WHERE position_id = ?').run(item.id);

    db.prepare(`INSERT INTO job_descriptions (position_id, ringkasan, tugas_json, wewenang_json, kualifikasi_json) VALUES (?, ?, ?, ?, ?)`)
      .run(item.id, item.deskripsi_pekerjaan.ringkasan, JSON.stringify(item.deskripsi_pekerjaan.tugas), JSON.stringify(item.deskripsi_pekerjaan.wewenang), JSON.stringify(item.deskripsi_pekerjaan.kualifikasi));
    db.prepare(`INSERT INTO document_controls (position_id, document_no, revision, effective_date, review_date, prepared_by, reviewed_by, approved_by, approval_status, change_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.document_control.document_no, item.document_control.revision, item.document_control.effective_date, item.document_control.review_date || null, item.document_control.prepared_by || '', item.document_control.reviewed_by || '', item.document_control.approved_by || '', item.document_control.approval_status, item.document_control.change_notes || '');

    const insertAssignment = db.prepare(`INSERT INTO employee_assignments (position_id, employee_id, employee_name, assignment_status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const incumbent of item.incumbents || []) insertAssignment.run(item.id, incumbent.employee_id || '', incumbent.employee_name || '', incumbent.assignment_status || 'active', incumbent.start_date || '', incumbent.end_date || null);
    const insertMovement = db.prepare(`INSERT INTO movement_history (position_id, movement_type, employee_id, employee_name, from_position_id, to_position_id, effective_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const movement of item.movement_history || []) insertMovement.run(item.id, movement.movement_type || '', movement.employee_id || '', movement.employee_name || '', movement.from_position_id || '', movement.to_position_id || item.id, movement.effective_date || '', movement.notes || '');

    createVersion(item.id, actorUserId, item.effective_date, item.effective_end_date || null, item);
    createApproval(item.id, actorUserId, options.approvalStatus || 'draft', `${action}: ${item.nama_jabatan}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  writeAudit(actorUserId, action, 'position', item.id, beforePosition, getPosition(item.id), ipAddress);
}

function createVersion(positionId, actorUserId, effectiveDate, effectiveEndDate, snapshot) {
  const current = db.prepare('SELECT COALESCE(MAX(version_no), 0) AS version_no FROM position_versions WHERE position_id = ?').get(positionId).version_no;
  db.prepare('INSERT INTO position_versions (position_id, version_no, effective_date, effective_end_date, snapshot_json, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(positionId, current + 1, effectiveDate, effectiveEndDate, JSON.stringify(snapshot), actorUserId);
}

function createApproval(positionId, actorUserId, status, notes) {
  db.prepare('INSERT INTO approval_workflows (entity_type, entity_id, action, status, submitted_by, reviewed_by, reviewed_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('position', positionId, 'position_change', status, actorUserId, status === 'approved' ? actorUserId : null, status === 'approved' ? new Date().toISOString() : null, notes);
}

function getPosition(positionId) {
  return getOrgData().find(item => item.id === positionId) || null;
}

function getPositionVersions(positionId) {
  return db.prepare(`
    SELECT pv.id, pv.position_id, pv.version_no, pv.effective_date, pv.effective_end_date, pv.snapshot_json, pv.created_at,
           u.username AS created_by_username
    FROM position_versions pv
    LEFT JOIN users u ON u.id = pv.created_by
    WHERE pv.position_id = ?
    ORDER BY pv.version_no DESC
  `).all(positionId).map(row => ({
    ...row,
    snapshot: safeJson(row.snapshot_json)
  }));
}

function getPositionVersionSnapshot(positionId, versionNo) {
  const row = db.prepare(`
    SELECT pv.id, pv.position_id, pv.version_no, pv.effective_date, pv.effective_end_date, pv.snapshot_json, pv.created_at,
           u.username AS created_by_username
    FROM position_versions pv
    LEFT JOIN users u ON u.id = pv.created_by
    WHERE pv.position_id = ? AND pv.version_no = ?
  `).get(positionId, versionNo);
  if (!row) return null;
  return { ...row, snapshot: safeJson(row.snapshot_json) };
}

function diffPositionSnapshots(fromSnapshot, toSnapshot) {
  const fields = [
    ['nama_jabatan', 'Position Name'],
    ['parent_id', 'Parent Position'],
    ['departemen', 'Department'],
    ['job_code', 'Job Code'],
    ['grade', 'Grade'],
    ['status', 'Position Status'],
    ['location', 'Location'],
    ['cost_center', 'Cost Center'],
    ['approved_headcount', 'Approved Headcount'],
    ['effective_date', 'Effective Date'],
    ['effective_end_date', 'Effective End Date'],
    ['deskripsi_pekerjaan.ringkasan', 'JD Summary'],
    ['deskripsi_pekerjaan.tugas', 'Duties'],
    ['deskripsi_pekerjaan.wewenang', 'Authority'],
    ['deskripsi_pekerjaan.kualifikasi', 'Qualifications'],
    ['document_control.document_no', 'Document No.'],
    ['document_control.revision', 'Revision'],
    ['document_control.effective_date', 'Document Effective Date'],
    ['document_control.review_date', 'Review Date'],
    ['document_control.prepared_by', 'Prepared By'],
    ['document_control.reviewed_by', 'Reviewed By'],
    ['document_control.approved_by', 'Approved By'],
    ['document_control.approval_status', 'Approval Status'],
    ['document_control.change_notes', 'Change Notes'],
    ['incumbents', 'Incumbents'],
    ['movement_history', 'Movement History']
  ];
  return fields.reduce((changes, [pathName, label]) => {
    const before = valueAtPath(fromSnapshot, pathName);
    const after = valueAtPath(toSnapshot, pathName);
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      changes.push({ path: pathName, label, from: before ?? null, to: after ?? null });
    }
    return changes;
  }, []);
}

function valueAtPath(source, pathName) {
  return pathName.split('.').reduce((value, key) => value == null ? undefined : value[key], source);
}

function getOrgDataAsOf(asOfDate) {
  const asOf = String(asOfDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return getOrgData();
  const rows = db.prepare(`
    SELECT pv.*
    FROM position_versions pv
    JOIN (
      SELECT position_id, MAX(version_no) AS version_no
      FROM position_versions
      WHERE effective_date <= ?
        AND (effective_end_date IS NULL OR effective_end_date = '' OR effective_end_date >= ?)
      GROUP BY position_id
    ) latest ON latest.position_id = pv.position_id AND latest.version_no = pv.version_no
    ORDER BY pv.position_id
  `).all(asOf, asOf);
  return normalizeData(rows.map(row => safeJson(row.snapshot_json)).filter(Boolean));
}

function isApprovedLocked(position) {
  return position?.document_control?.approval_status === 'approved';
}

function nextRevision(revision) {
  const text = String(revision || '').trim();
  const match = text.match(/^(.*?)(\d+)\s*$/);
  if (!match) return 'Rev. 01';
  const next = String(Number(match[2]) + 1).padStart(match[2].length, '0');
  return `${match[1]}${next}`;
}

function getOrgData() {
  const rows = db.prepare(`
    SELECT p.*, jd.ringkasan, jd.tugas_json, jd.wewenang_json, jd.kualifikasi_json,
           dc.document_no, dc.revision, dc.effective_date AS dc_effective_date, dc.review_date,
           dc.prepared_by, dc.reviewed_by, dc.approved_by, dc.approval_status, dc.change_notes
    FROM positions p
    LEFT JOIN job_descriptions jd ON jd.position_id = p.id
    LEFT JOIN document_controls dc ON dc.position_id = p.id
    ORDER BY p.id
  `).all();
  return rows.map(row => ({
    id: row.id,
    nama_jabatan: row.nama_jabatan,
    parent_id: row.parent_id,
    departemen: row.departemen,
    job_code: row.job_code,
    grade: row.grade,
    status: row.status,
    location: row.location,
    cost_center: row.cost_center,
    approved_headcount: row.approved_headcount,
    effective_date: row.effective_date,
    effective_end_date: row.effective_end_date,
    updated_at: row.updated_at,
    incumbents: db.prepare('SELECT employee_id, employee_name, assignment_status, start_date, end_date FROM employee_assignments WHERE position_id = ? ORDER BY id').all(row.id),
    movement_history: db.prepare('SELECT movement_type, employee_id, employee_name, from_position_id, to_position_id, effective_date, notes FROM movement_history WHERE position_id = ? ORDER BY id').all(row.id),
    document_control: {
      document_no: row.document_no || `JD-${row.id.toUpperCase()}`,
      revision: row.revision || 'Rev. 00',
      effective_date: row.dc_effective_date || row.effective_date,
      review_date: row.review_date || '',
      prepared_by: row.prepared_by || '',
      reviewed_by: row.reviewed_by || '',
      approved_by: row.approved_by || '',
      approval_status: row.approval_status || 'draft',
      change_notes: row.change_notes || ''
    },
    deskripsi_pekerjaan: {
      ringkasan: row.ringkasan || '',
      tugas: parseJsonArray(row.tugas_json),
      wewenang: parseJsonArray(row.wewenang_json),
      kualifikasi: parseJsonArray(row.kualifikasi_json)
    }
  }));
}

function safeJson(value) {
  try {
    return JSON.parse(value || 'null');
  } catch {
    return null;
  }
}

function getAuditLogs() {
  return db.prepare(`
    SELECT a.id, a.action, a.entity_type, a.entity_id, a.before_json, a.after_json, a.ip_address, a.created_at,
           u.username AS actor_username, u.role AS actor_role
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.id DESC
    LIMIT 200
  `).all();
}

function getApprovals() {
  return db.prepare(`
    SELECT aw.*, submitter.username AS submitted_by_username, reviewer.username AS reviewed_by_username
    FROM approval_workflows aw
    LEFT JOIN users submitter ON submitter.id = aw.submitted_by
    LEFT JOIN users reviewer ON reviewer.id = aw.reviewed_by
    ORDER BY aw.id DESC
    LIMIT 200
  `).all();
}

function writeAudit(actorUserId, action, entityType, entityId, beforeValue, afterValue, ipAddress) {
  db.prepare('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(actorUserId, action, entityType, entityId, beforeValue == null ? null : JSON.stringify(beforeValue), afterValue == null ? null : JSON.stringify(afterValue), ipAddress || null);
}

function normalizeData(data) {
  const statuses = ['active', 'draft', 'inactive', 'obsolete'];
  const approvalStatuses = ['draft', 'reviewed', 'approved', 'obsolete'];
  const today = new Date().toISOString().slice(0, 10);
  return (Array.isArray(data) ? data : []).map(item => ({
    id: String(item.id || '').trim(),
    nama_jabatan: String(item.nama_jabatan || 'Untitled Position').trim() || 'Untitled Position',
    parent_id: item.parent_id ? String(item.parent_id).trim() : null,
    departemen: String(item.departemen || '-').trim() || '-',
    job_code: String(item.job_code || '-').trim() || '-',
    grade: String(item.grade || '-').trim() || '-',
    status: statuses.includes(item.status) ? item.status : 'active',
    location: String(item.location || '-').trim() || '-',
    cost_center: String(item.cost_center || '-').trim() || '-',
    approved_headcount: Number.isFinite(Number(item.approved_headcount)) && Number(item.approved_headcount) > 0 ? Number(item.approved_headcount) : 1,
    effective_date: item.effective_date || today,
    effective_end_date: item.effective_end_date || null,
    updated_at: item.updated_at || today,
    incumbents: Array.isArray(item.incumbents) ? item.incumbents : [],
    movement_history: Array.isArray(item.movement_history) ? item.movement_history : [],
    document_control: {
      document_no: item.document_control?.document_no || `JD-${String(item.id || '').toUpperCase()}`,
      revision: item.document_control?.revision || 'Rev. 00',
      effective_date: item.document_control?.effective_date || item.effective_date || today,
      review_date: item.document_control?.review_date || '',
      prepared_by: item.document_control?.prepared_by || '',
      reviewed_by: item.document_control?.reviewed_by || '',
      approved_by: item.document_control?.approved_by || '',
      approval_status: approvalStatuses.includes(item.document_control?.approval_status) ? item.document_control.approval_status : 'draft',
      change_notes: item.document_control?.change_notes || ''
    },
    deskripsi_pekerjaan: {
      ringkasan: item.deskripsi_pekerjaan?.ringkasan || '',
      tugas: Array.isArray(item.deskripsi_pekerjaan?.tugas) ? item.deskripsi_pekerjaan.tugas : [],
      wewenang: Array.isArray(item.deskripsi_pekerjaan?.wewenang) ? item.deskripsi_pekerjaan.wewenang : [],
      kualifikasi: Array.isArray(item.deskripsi_pekerjaan?.kualifikasi) ? item.deskripsi_pekerjaan.kualifikasi : []
    }
  })).filter(item => item.id);
}

function normalizePositionPayload(payload) {
  const normalized = normalizeData([payload.position || payload]);
  return normalized[0] || null;
}

function validateStructure(data) {
  const errors = [];
  const ids = data.map(x => x.id);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) errors.push('Ada ID posisi yang duplikat.');
  data.forEach(item => {
    if (!item.id) errors.push('Ada posisi tanpa ID.');
    if (item.parent_id && !idSet.has(item.parent_id)) errors.push(`Parent position tidak ditemukan untuk ${item.nama_jabatan}.`);
    if (item.parent_id === item.id) errors.push(`${item.nama_jabatan} tidak boleh menjadi atasan dirinya sendiri.`);
  });
  data.forEach(item => { if (hasCircularParent(item.id, item.parent_id, data)) errors.push(`Circular reporting terdeteksi pada ${item.nama_jabatan}.`); });
  return errors;
}

function hasCircularParent(id, parentId, data) {
  const seen = new Set([id]);
  let currentParent = parentId;
  while (currentParent) {
    if (seen.has(currentParent)) return true;
    seen.add(currentParent);
    const parent = data.find(x => x.id === currentParent);
    currentParent = parent?.parent_id || null;
  }
  return false;
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  if (statusCode === 204) response.end();
  else response.end(JSON.stringify(payload));
}

function serveStatic(pathname, response) {
  let decodedPath = '/';
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
    return;
  }
  const requestedPath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, requestedPath);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(data);
  });
}

function cleanupExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

function getIp(request) {
  return request.headers['x-forwarded-for'] || request.socket.remoteAddress || null;
}





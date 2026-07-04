const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const testDbPath = path.join(root, 'data', '.smoke-test.sqlite');

function removeIfExists(filePath) {
  try { fs.rmSync(filePath, { force: true }); } catch {}
}

function cleanupTestDb() {
  for (const suffix of ['', '-journal', '-wal', '-shm']) removeIfExists(testDbPath + suffix);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, child) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw lastError || new Error('server health check timed out');
}

async function api(baseUrl, method, pathname, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { status: response.status, ok: response.ok, payload };
}

async function login(baseUrl, username, password) {
  const result = await api(baseUrl, 'POST', '/api/auth/login', { body: { username, password } });
  assert.equal(result.status, 200, `login failed for ${username}`);
  assert.ok(result.payload.token, `missing token for ${username}`);
  return result.payload;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function checkFrontendScriptSyntax() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  for (const script of scripts) new Function(script);
  return scripts.length;
}

async function run() {
  cleanupTestDb();
  const frontendScriptCount = checkFrontendScriptSyntax();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ORG_PORTAL_DB_PATH: testDbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    const health = await waitForHealth(baseUrl, child);
    assert.equal(health.ok, true);
    assert.equal(health.database, 'sqlite');

    const publicRead = await api(baseUrl, 'GET', '/api/org-data');
    assert.equal(publicRead.status, 401, 'org data should require auth');

    const employee = await login(baseUrl, 'employee', 'employee123');
    assert.equal(employee.user.role, 'employee');
    const employeeRead = await api(baseUrl, 'GET', '/api/org-data', { token: employee.token });
    assert.equal(employeeRead.status, 200);
    assert.equal(employeeRead.payload.length, 7, 'sample org data should seed 7 positions');
    const employeeWrite = await api(baseUrl, 'PUT', '/api/org-data', { token: employee.token, body: { positions: employeeRead.payload } });
    assert.equal(employeeWrite.status, 403, 'employee must not write org data');

    const admin = await login(baseUrl, 'admin', 'admin123');
    assert.equal(admin.user.role, 'admin');
    const adminRead = await api(baseUrl, 'GET', '/api/org-data', { token: admin.token });
    assert.equal(adminRead.status, 200);
    assert.equal(adminRead.payload.length, 7);

    const duplicate = clone(adminRead.payload);
    duplicate[1].id = duplicate[0].id;
    const duplicateSave = await api(baseUrl, 'PUT', '/api/org-data', { token: admin.token, body: { positions: duplicate } });
    assert.equal(duplicateSave.status, 400, 'duplicate IDs must be rejected');

    const invalidParent = clone(adminRead.payload);
    invalidParent[0].parent_id = 'missing_parent';
    const invalidParentSave = await api(baseUrl, 'PUT', '/api/org-data', { token: admin.token, body: { positions: invalidParent } });
    assert.equal(invalidParentSave.status, 400, 'invalid parent must be rejected');

    const circular = clone(adminRead.payload);
    const ceo = circular.find(item => item.id === 'ceo');
    ceo.parent_id = 'od_specialist';
    const circularSave = await api(baseUrl, 'PUT', '/api/org-data', { token: admin.token, body: { positions: circular } });
    assert.equal(circularSave.status, 400, 'circular reporting must be rejected');

    const changed = clone(adminRead.payload);
    changed[0].document_control.change_notes = 'Automated smoke test save';
    const save = await api(baseUrl, 'PUT', '/api/org-data', { token: admin.token, body: { positions: changed } });
    assert.equal(save.status, 200);
    assert.equal(save.payload.ok, true);
    assert.equal(save.payload.positions.length, 7);

    const newPosition = {
      id: 'hr_business_partner',
      nama_jabatan: 'HR Business Partner',
      parent_id: 'hr_manager',
      departemen: 'Human Resources',
      job_code: 'HR-BP-001',
      grade: 'Specialist',
      status: 'draft',
      location: 'Head Office',
      cost_center: 'HR-BP',
      approved_headcount: 1,
      effective_date: '2026-07-04',
      updated_at: '2026-07-04',
      incumbents: [],
      movement_history: [],
      document_control: {
        document_no: 'JD-HR-BP-001',
        revision: 'Rev. 00',
        effective_date: '2026-07-04',
        review_date: '2027-07-04',
        prepared_by: 'Organization Development',
        reviewed_by: '',
        approved_by: '',
        approval_status: 'draft',
        change_notes: 'Smoke test granular create.'
      },
      deskripsi_pekerjaan: {
        ringkasan: 'Partner HR untuk unit bisnis.',
        tugas: ['Mendukung kebutuhan people agenda unit bisnis.'],
        wewenang: ['Memberikan rekomendasi HR kepada business leader.'],
        kualifikasi: ['Pengalaman HR minimal 3 tahun.']
      }
    };
    const createPosition = await api(baseUrl, 'POST', '/api/positions', { token: admin.token, body: { position: newPosition } });
    assert.equal(createPosition.status, 201);
    assert.equal(createPosition.payload.positions.length, 8);
    assert.equal(createPosition.payload.position.parent_id, 'hr_manager');

    const duplicatePosition = await api(baseUrl, 'POST', '/api/positions', { token: admin.token, body: { position: newPosition } });
    assert.equal(duplicatePosition.status, 409, 'granular create must reject duplicate IDs');

    const editedPosition = clone(createPosition.payload.position);
    editedPosition.deskripsi_pekerjaan.ringkasan = 'Updated through granular endpoint.';
    editedPosition.document_control.change_notes = 'Smoke test granular update.';
    const updatePosition = await api(baseUrl, 'PUT', '/api/positions/hr_business_partner', { token: admin.token, body: { position: editedPosition } });
    assert.equal(updatePosition.status, 200);
    assert.equal(updatePosition.payload.position.deskripsi_pekerjaan.ringkasan, 'Updated through granular endpoint.');

    const reportingLine = await api(baseUrl, 'PATCH', '/api/positions/hr_business_partner/reporting-line', { token: admin.token, body: { parent_id: 'hr_director' } });
    assert.equal(reportingLine.status, 200);
    assert.equal(reportingLine.payload.position.parent_id, 'hr_director');

    const circularReportingLine = await api(baseUrl, 'PATCH', '/api/positions/hr_director/reporting-line', { token: admin.token, body: { parent_id: 'hr_business_partner' } });
    assert.equal(circularReportingLine.status, 400, 'granular reporting-line endpoint must reject circular reporting');

    const statusPatch = await api(baseUrl, 'PATCH', '/api/positions/hr_business_partner/status', { token: admin.token, body: { status: 'inactive' } });
    assert.equal(statusPatch.status, 200);
    assert.equal(statusPatch.payload.position.status, 'inactive');

    const submitApproval = await api(baseUrl, 'POST', '/api/positions/hr_business_partner/submit', { token: admin.token, body: { notes: 'Submit smoke test approval.' } });
    assert.equal(submitApproval.status, 200);
    assert.equal(submitApproval.payload.position.document_control.approval_status, 'reviewed');
    const submittedWorkflow = submitApproval.payload.approvals.find(row => row.entity_id === 'hr_business_partner' && row.status === 'submitted');
    assert.ok(submittedWorkflow, 'submit should create a submitted approval workflow');

    const approveWorkflow = await api(baseUrl, 'POST', '/api/approvals/review', { token: admin.token, body: { id: submittedWorkflow.id, status: 'approved', notes: 'Approved by smoke test.' } });
    assert.equal(approveWorkflow.status, 200);
    assert.equal(approveWorkflow.payload.position.document_control.approval_status, 'approved');

    const lockedEdit = clone(approveWorkflow.payload.position);
    lockedEdit.deskripsi_pekerjaan.ringkasan = 'This edit should be locked.';
    lockedEdit.document_control.approval_status = 'draft';
    const lockedEditResult = await api(baseUrl, 'PUT', '/api/positions/hr_business_partner', { token: admin.token, body: { position: lockedEdit } });
    assert.equal(lockedEditResult.status, 409, 'approved JD must be locked against direct edits');

    const draftRevision = await api(baseUrl, 'POST', '/api/positions/hr_business_partner/draft-revision', { token: admin.token, body: { notes: 'Create draft revision from smoke test.' } });
    assert.equal(draftRevision.status, 200);
    assert.equal(draftRevision.payload.position.document_control.approval_status, 'draft');
    assert.equal(draftRevision.payload.position.document_control.revision, 'Rev. 01');

    const versions = await api(baseUrl, 'GET', '/api/positions/hr_business_partner/versions', { token: admin.token });
    assert.equal(versions.status, 200);
    assert.ok(versions.payload.length >= 5, 'version history should capture granular governance changes');
    assert.ok(versions.payload[0].snapshot, 'version history should include parsed snapshots');

    const newestVersion = versions.payload[0].version_no;
    const oldestVersion = versions.payload[versions.payload.length - 1].version_no;
    const versionCompare = await api(baseUrl, 'GET', `/api/positions/hr_business_partner/versions/compare?from=${oldestVersion}&to=${newestVersion}`, { token: admin.token });
    assert.equal(versionCompare.status, 200);
    assert.ok(versionCompare.payload.changes.length >= 1, 'version compare should report changed fields');

    const versionRestore = await api(baseUrl, 'POST', `/api/positions/hr_business_partner/versions/${oldestVersion}/restore`, { token: admin.token, body: { notes: 'Restore oldest version as draft from smoke test.' } });
    assert.equal(versionRestore.status, 200);
    assert.equal(versionRestore.payload.position.document_control.approval_status, 'draft');
    assert.equal(versionRestore.payload.position.document_control.revision, 'Rev. 02');

    const asOfOrg = await api(baseUrl, 'GET', '/api/org-data?as_of=2026-07-04', { token: employee.token });
    assert.equal(asOfOrg.status, 200);
    assert.ok(asOfOrg.payload.some(position => position.id === 'hr_business_partner'), 'effective-dated view should include active snapshots for the selected date');

    const importResult = await api(baseUrl, 'POST', '/api/org-data/import', { token: admin.token, body: { positions: changed } });
    assert.equal(importResult.status, 200);
    assert.equal(importResult.payload.ok, true);

    const reset = await api(baseUrl, 'POST', '/api/org-data/reset', { token: admin.token });
    assert.equal(reset.status, 200);
    assert.equal(reset.payload.positions.length, 7);

    const audit = await api(baseUrl, 'GET', '/api/audit-logs', { token: admin.token });
    assert.equal(audit.status, 200);
    assert.ok(audit.payload.length >= 1, 'audit logs should exist');

    const approvals = await api(baseUrl, 'GET', '/api/approvals', { token: admin.token });
    assert.equal(approvals.status, 200);
    assert.ok(approvals.payload.length >= 7, 'approval rows should exist');

    const staticPage = await fetch(baseUrl);
    assert.equal(staticPage.status, 200);
    const html = await staticPage.text();
    assert.ok(html.includes('Org Structure & Job Description Portal'));

    console.log(JSON.stringify({ ok: true, port, checks: 35, frontendScriptCount }, null, 2));
  } catch (error) {
    console.error('Smoke test failed');
    console.error(error.stack || error.message);
    if (stdout.trim()) console.error(`\nserver stdout:\n${stdout}`);
    if (stderr.trim()) console.error(`\nserver stderr:\n${stderr}`);
    process.exitCode = 1;
  } finally {
    child.kill();
    await sleep(200);
    cleanupTestDb();
  }
}

run();

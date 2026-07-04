# Org Structure & Job Description Portal

Front-end MVP untuk visualisasi struktur organisasi perusahaan dan Job Description berbasis satu halaman HTML.

## Fitur Utama

- Tree view struktur organisasi berbasis `id` dan `parent_id`.
- Klik posisi untuk melihat Job Description.
- Mode Karyawan: view dan download JD via print-to-PDF.
- Mode Admin: edit JD, metadata posisi, document control, reporting line, status posisi, incumbents, dan movement history sederhana.
- Tambah posisi baru.
- Ubah parent position untuk simulasi mutasi struktur/reorganisasi.
- Status posisi: `active`, `draft`, `inactive`, `obsolete`.
- Document control: document number, revision, effective date, review date, prepared/reviewed/approved by, approval status, change notes.
- Import/export JSON.
- Validasi struktur: ID unik, parent valid, dan anti circular reporting.
- Collapse/expand tree.
- Search dan filter departemen/status.
- Penyimpanan lokal via `localStorage`.

## Cara Menjalankan

### Opsi 1: Buka langsung

Buka file `index.html` di browser modern.

### Opsi 2: Local server

```bash
cd org-jd-structure-codex-v2
npm start
```

Lalu buka:

```text
http://localhost:5173
```

## Struktur Folder

```text
org-jd-structure-codex-v2/
â”œâ”€â”€ index.html
â”œâ”€â”€ README.md
â”œâ”€â”€ AGENTS.md
â”œâ”€â”€ package.json
â”œâ”€â”€ data/
â”‚   â””â”€â”€ sample-org-data.json
â””â”€â”€ docs/
    â”œâ”€â”€ prd.md
    â”œâ”€â”€ ui-guideline.md
    â”œâ”€â”€ implementation.md
    â”œâ”€â”€ 01_scope_of_task.md
    â”œâ”€â”€ 02_frontend_specification.md
    â””â”€â”€ 03_data_schema.md
```

## Catatan Produksi

Mode Admin dalam MVP ini hanya simulasi front-end. Untuk production wajib menggunakan backend, login, database, role-based access control, audit trail, approval workflow, dan version control dokumen.

## Backend MVP

`npm start` menjalankan static server dan API backend Node.js tanpa dependency eksternal. Database SQLite dibuat otomatis di:

```text
data/org-portal.sqlite
```

Akun demo:

```text
employee / employee123
admin / admin123
```

Backend menyediakan auth/session token, RBAC, table position/JD/document control/assignment/movement history, audit log, approval workflow, dan position version snapshot. Jika `index.html` dibuka langsung tanpa server, aplikasi tetap fallback ke localStorage mode.

Admin backend UI juga menyediakan status proses saat login/save/import/reset, pesan sukses/error yang tetap terlihat, serta export CSV untuk Approval Workflow dan Audit Log.

Endpoint Admin granular yang tersedia:

```text
POST  /api/positions
PUT   /api/positions/:id
PATCH /api/positions/:id/reporting-line
PATCH /api/positions/:id/status
POST  /api/positions/:id/submit
POST  /api/positions/:id/draft-revision
GET   /api/positions/:id/versions
GET   /api/positions/:id/versions/compare?from=N&to=M
POST  /api/positions/:id/versions/:version_no/restore
POST  /api/approvals/review
GET   /api/org-data?as_of=YYYY-MM-DD
```

Import dan reset tetap memakai endpoint bulk karena fungsinya memang mengganti dataset.

Governance backend mendukung save draft, submit approval, approve/reject, lock JD yang sudah approved, draft revision untuk perubahan berikutnya, version snapshot, compare antar version, restore version sebagai draft, dan effective-dated organization view.

## Integrasi Express + MariaDB

File `index.html` saat ini diarahkan ke backend Express MariaDB:

```text
https://org-jd-portal-api-production.up.railway.app/api
```

Jalankan backend Express di folder `C:\xampp\htdocs\strukur organisasi API`, lalu jalankan frontend ini di port `5173`. Login admin memakai:

```text
admin / admin12345
```

Jika URL backend berubah, set di browser console:

```js
localStorage.setItem('orgStructureJD.v3.apiBaseUrl', 'https://org-jd-portal-api-production.up.railway.app')
```

## Testing

Run the automated backend smoke test:

```bash
npm test
```

The test runner starts a temporary server on a free port and uses a separate SQLite database file, so it does not modify the main `data/org-portal.sqlite` database.

Current smoke test coverage includes backend health, auth/RBAC, structure validation, granular position create/update/reporting-line/status endpoints, approval submit/review/lock/draft-revision/version history/version compare/restore-as-draft/effective-dated view, import/reset, audit/approval rows, static page response, and frontend inline script syntax.

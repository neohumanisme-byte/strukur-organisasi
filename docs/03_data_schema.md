# Data Schema

## Position Object

```json
{
  "id": "hr_manager",
  "nama_jabatan": "HR Manager",
  "parent_id": "hr_director",
  "departemen": "Human Resources",
  "job_code": "HR-002",
  "grade": "Manager",
  "status": "active",
  "location": "Head Office",
  "cost_center": "HR",
  "approved_headcount": 1,
  "effective_date": "2026-07-04",
  "updated_at": "2026-07-04",
  "incumbents": [],
  "movement_history": [],
  "document_control": {},
  "deskripsi_pekerjaan": {}
}
```

## Status Values

- `active`
- `draft`
- `inactive`
- `obsolete`

## Job Description Object

```json
{
  "ringkasan": "...",
  "tugas": ["..."],
  "wewenang": ["..."],
  "kualifikasi": ["..."]
}
```

## Document Control Object

```json
{
  "document_no": "JD-HR-002",
  "revision": "Rev. 01",
  "effective_date": "2026-07-04",
  "review_date": "2027-07-04",
  "prepared_by": "Organization Development",
  "reviewed_by": "HR Manager",
  "approved_by": "HR Director",
  "approval_status": "approved",
  "change_notes": "Initial release"
}
```

## Approval Status Values

- `draft`
- `reviewed`
- `approved`
- `obsolete`

## Incumbent Object

```json
{
  "employee_id": "EMP-001",
  "employee_name": "Nama Karyawan",
  "assignment_status": "active",
  "start_date": "2026-07-01"
}
```

## Movement History Object

```json
{
  "movement_type": "promotion",
  "employee_id": "EMP-001",
  "employee_name": "Nama Karyawan",
  "from_position_id": "hr_supervisor",
  "to_position_id": "hr_manager",
  "effective_date": "2026-07-01",
  "notes": "Promosi berdasarkan kebutuhan organisasi"
}
```

## Movement Type Recommendation

- `promotion`
- `mutation`
- `rotation`
- `demotion`
- `assignment`
- `acting`

## Governance Recommendation

For production, separate position structure from employee assignment and movement history to avoid mixing organization design data with personal employee data.

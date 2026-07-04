# Product Requirements Document — Org Structure & Job Description Portal

## 1. Product Summary

The product is a single-page front-end application that visualizes the company organization structure and enables employees to access Job Description information by clicking each position node.

The first release is a front-end MVP. It uses static JSON and localStorage to simulate data persistence before backend implementation.

## 2. Business Problem

Employees often need to find their role responsibilities, authority, qualifications, and reporting line. When Job Descriptions are stored in scattered documents, it creates ambiguity and weak governance. HR/OD also needs a practical way to maintain position data, JD updates, and organization changes.

## 3. Goals

1. Make organization structure easy to understand.
2. Make Job Descriptions accessible to employees.
3. Provide a formal JD view that can be printed as PDF.
4. Allow Admin to update JD and position metadata in the MVP.
5. Accommodate organizational changes such as new position, reporting line change, mutation, and promotion simulation.
6. Prepare the structure for future backend, database, approval, and audit trail.

## 4. User Roles

### Employee

- Can view organization tree.
- Can open Job Description.
- Can download/print Job Description.
- Cannot edit data.

### Admin

- Can do everything Employee can do.
- Can add new position.
- Can edit Job Description.
- Can edit reporting line/parent position.
- Can update document control.
- Can mark position inactive/obsolete.
- Can import/export JSON.

## 5. Functional Requirements

### FR-01 Tree View

Render hierarchical organization structure from `id` and `parent_id`.

### FR-02 Job Description Detail

Show position detail, reporting path, JD sections, incumbent data, movement history, and document control.

### FR-03 Admin Editing

Admin can edit:

- Position name
- Department
- Job code
- Grade
- Location
- Cost center
- Approved headcount
- Effective date
- Status
- Parent position
- JD summary
- Duties
- Authority
- Qualification
- Incumbents
- Movement history
- Document control

### FR-04 Add New Position

Admin can create a new position from UI. The system must prevent duplicate IDs.

### FR-05 Reporting Line Change

Admin can change `parent_id`. The system must prevent self-parenting and circular reporting.

### FR-06 Position Status

Support status: `active`, `draft`, `inactive`, `obsolete`.

### FR-07 Document Control

Each JD must include:

- Document number
- Revision
- Effective date
- Review date
- Prepared by
- Reviewed by
- Approved by
- Approval status
- Change notes

### FR-08 Import/Export JSON

Admin can import JSON to replace current local data and export current data as JSON backup.

### FR-09 Print-to-PDF

All roles can print or save JD as PDF using browser print.

### FR-10 Validation

Validate unique ID, valid parent, no circular hierarchy.

## 6. Non-Functional Requirements

- Responsive mobile-first design.
- Corporate elegant visual style.
- Tailwind CSS via CDN only.
- Vanilla JavaScript only.
- No backend in phase 1.
- Usable by opening `index.html` directly.
- WCAG-friendly contrast.

## 7. Out of Scope for MVP

- Real authentication.
- Backend database.
- Multi-user synchronization.
- Real approval workflow.
- E-signature.
- Full audit trail.
- HRIS integration.

## 8. Future Roadmap

### Phase 2

- Backend API.
- Database.
- Login and role-based access control.
- Audit trail.
- Approval workflow.

### Phase 3

- HRIS integration.
- Employee master sync.
- Version history.
- Effective-dated organization chart.

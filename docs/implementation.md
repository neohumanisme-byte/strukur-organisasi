# Implementation Guide

## 1. Architecture

The app is a single HTML file with embedded Tailwind CDN, CSS, and JavaScript.

State flow:

1. Load data from localStorage.
2. If localStorage is empty, use `defaultOrgData`.
3. Normalize data shape.
4. Validate structure.
5. Render summary, filters, and tree.
6. Open detail panel on node click.
7. Save Admin edits back to localStorage.

## 2. Core Functions

| Function | Purpose |
|---|---|
| `normalizeData()` | Ensures every data object has required fields. |
| `validateStructure()` | Validates duplicate ID, invalid parent, and circular reporting. |
| `getChildren()` | Gets child positions by parent ID. |
| `getRoots()` | Gets positions without valid parent. |
| `getReportingPath()` | Builds breadcrumb from root to selected position. |
| `renderTree()` | Renders recursive tree. |
| `renderPanel()` | Renders detail drawer. |
| `renderAdminForm()` | Renders Admin edit form. |
| `createPosition()` | Adds a new position. |
| `savePositionForm()` | Saves Admin edits. |
| `exportJson()` | Downloads current org data. |
| `importJson()` | Imports JSON and replaces local data. |
| `printJD()` | Generates print area and opens browser print. |

## 3. Position Management

Admin can add and edit position master data. Mandatory validation:

- ID must be unique.
- Parent must exist or be null.
- Position cannot report to itself.
- Circular reporting must be blocked.

## 4. Mutation and Promotion Support

MVP accommodates this in two ways:

1. **Reporting line mutation / organization restructure** through editable `parent_id`.
2. **Employee movement record** through `movement_history` field.

Production recommendation:

- Move employee assignment and movement history to separate database tables.
- Add effective dating.
- Add approval and audit trail.

## 5. localStorage Keys

| Key | Purpose |
|---|---|
| `orgStructureJD.v2.data` | Current organization data. |
| `orgStructureJD.v2.role` | Active role. |
| `orgStructureJD.v2.collapsed` | Collapsed tree nodes. |

## 6. JSON Import Rules

Imported JSON must be an array of position objects. After normalization, it must pass structure validation.

## 7. Backend Migration Notes

Future backend should split into tables:

- `positions`
- `job_descriptions`
- `document_controls`
- `employee_assignments`
- `movement_history`
- `users`
- `roles`
- `audit_logs`

## 8. Production Security Notes

The Admin toggle is not secure. For production, implement:

- Authentication.
- Authorization.
- API validation.
- Server-side audit log.
- Approval workflow.
- Encrypted transport.

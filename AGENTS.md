# AGENTS.md

## Project Identity

You are working on a front-end MVP called **Org Structure & Job Description Portal**. The application visualizes company organization structure and job descriptions in a single-page web application.

## Primary Objective

Maintain and improve a lightweight front-end first application using:

- HTML5
- Tailwind CSS via CDN Play only
- Vanilla JavaScript ES6+
- localStorage for MVP persistence
- No backend
- No heavy framework
- No build step required

## Must-Preserve Features

Do not remove or break these features:

1. Tree rendering from `id` and `parent_id`.
2. Role simulation: Employee and Admin.
3. Employee mode: view and print-to-PDF only.
4. Admin mode: create/edit position, edit parent position, edit JD, save to localStorage.
5. Document control fields.
6. Status fields: active, draft, inactive, obsolete.
7. Import/export JSON.
8. Structure validation: unique ID, valid parent, no circular reporting.
9. Collapse/expand tree.
10. Search and filter.
11. Print-specific styling.
12. Responsive corporate UI.

## Required Documentation References

Before changing code, read:

- `docs/prd.md`
- `docs/ui-guideline.md`
- `docs/implementation.md`
- `docs/03_data_schema.md`

## Development Principles

- Keep the UI corporate, elegant, accessible, and responsive.
- Prefer clear functions and readable code over clever abstraction.
- Keep comments useful for HR/OD users and non-technical maintainers.
- Do not introduce external dependencies unless explicitly requested.
- Maintain compatibility with opening `index.html` directly in a browser.
- Do not store sensitive employee data beyond dummy/sample fields in this MVP.

## Data Governance Rules

Position data and employee movement data must be conceptually separated:

- Position Master: structure, JD, grade, department, status, document control.
- Employee Assignment: incumbent and assignment status.
- Movement History: mutation, promotion, rotation, demotion records.

For MVP, employee assignment and movement history may remain embedded in the position object. For production, they should become separate database tables.

## Acceptance Rule

Any code change must keep the app executable with:

```bash
npm start
```

and also by directly opening `index.html` in the browser.

# UI Guideline — Corporate Elegant Organization Portal

## 1. Design Direction

Style: corporate, elegant, clean, structured, professional.

The UI must help employees quickly understand position hierarchy and Job Description content without feeling overloaded.

## 2. Color Palette

| Purpose | Color |
|---|---|
| Primary Navy | `#0F172A` |
| Secondary Navy | `#1E293B` |
| Slate Text | `#334155` |
| Muted Text | `#64748B` |
| Background | `#F8FAFC` |
| Card | `#FFFFFF` |
| Accent Teal | `#0F766E` |
| Accent Gold | `#C89B3C` |
| Border | `#E2E8F0` |

## 3. Typography

Use Inter via Google Fonts with system fallback. Headings must be bold and compact. Body text must be readable with generous line height.

## 4. Layout

- Sticky header.
- Summary cards at top.
- Toolbar with search/filter/actions.
- Tree container with internal scrolling.
- Right-side detail panel/modal.
- Print area hidden except in print mode.

## 5. Components

### Node Card

Must display:

- Position name
- Department
- Job code
- Grade
- Status badge
- Approval badge
- Location
- Effective date
- Headcount

### Status Badge

- Active: green
- Draft: amber
- Inactive: slate
- Obsolete: red/rose

### Approval Badge

- Approved: green
- Reviewed: blue
- Draft: amber
- Obsolete: rose

### Admin Forms

Admin forms should use:

- Rounded inputs
- Clear labels
- Helper text where needed
- Sticky bottom action buttons
- Full-width mobile buttons

### Side Panel

Use right drawer on desktop and full-width drawer on mobile. Include close button, mode badge, title, subtitle, and reporting breadcrumb.

## 6. Responsive Rules

- Mobile-first.
- Card and form fields stack on mobile.
- Tree container can scroll.
- Buttons must remain tap-friendly.

## 7. Accessibility

- Maintain sufficient color contrast.
- Use semantic headings.
- Provide visible focus states.
- Provide skip link.
- Close panel via Escape.

## 8. Print Design

Print output should look like a formal JD document:

- Title and document header.
- Position metadata table.
- Reporting line.
- JD sections.
- Document control.
- No buttons, header, or app controls.

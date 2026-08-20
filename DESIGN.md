# Map Data Quality Lab Design Baseline

This document is the canonical UI/UX baseline for the Map Data Quality Lab
dev-preview. Read it before making a visual or interaction change. If a change
introduces a durable visual or UX decision, update this document in the same
change.

The document is intentionally English and tracked: it is a shared product
baseline, not private operating context. The public product and data boundaries
in [`README.md`](./README.md) and [`docs/architecture.md`](./docs/architecture.md)
remain authoritative when they conflict with a purely visual preference.

## Product role

The preview is an inspection surface for an AOI-scoped, source-aware data
provider. It helps a user prepare an AOI, choose delivered layers, inspect
provenance and readiness, and examine source-backed map objects. It is not an
operational dashboard, network simulator, or a global infrastructure map.

OpenInfraMap is a useful interaction reference for inspecting a station, line,
and circuit relationship. It is not a product, cartographic, or data-model
template to clone. All displayed relationships must remain bounded by the
provider's delivered evidence.

## Design principles

1. **Map first.** The map is the primary canvas; panels are temporary,
   dismissible tools rather than a permanent dashboard layout.
2. **Evidence before implication.** Show source, readiness, limitations, and
   verification state where they affect interpretation. Never make geometry,
   circuit membership, endpoints, routing, flow, or cascade behaviour appear
   more certain than the provider contract supports.
3. **One action, one home.** A user-facing selection action has one canonical
   control surface. Do not duplicate circuit or line selection between a map
   popup and a drawer.
4. **Progressive disclosure.** Keep map popups compact; place persistent
   details in a small edge inspector. Avoid adding information solely because
   it is available in raw OSM tags.
5. **Quiet chrome, legible data.** Glass surfaces frame the map without
   becoming opaque slabs. Selection and errors remain visually unambiguous on
   every supported basemap.
6. **No deceptive polish.** Reference overlays stay visually and semantically
   distinct from analytical vectors. A visually compelling state must not hide
   missing source evidence or an unavailable result.

## Workspace anatomy

| Area | Responsibility | Interaction rule |
| --- | --- | --- |
| Header | Product identity and prepared-AOI summary | Persistent, low-density context only. |
| Map canvas | Delivered PMTiles layers and bounded reference overlays | Primary interaction surface. |
| Left context drawer | AOI, layers, providers, legend, source inspection | Open only on demand and be dismissible. |
| Right icon rail | Entry points to drawers and activity log | Active tool must have a visible active state. |
| Bottom status | AOI, visible-feature count, basemap, zoom and close-zoom guidance | Read-only, concise, never obscures a key map control. |
| Activity window | Preparation and validation events | Floating, draggable, resizable, and visually consistent with drawers. |
| Selected-line edge inspector | Persistent detail for a chosen verified power line | Anchored at the map edge, not to a geographical coordinate. |

At desktop widths, drawers sit on the left and the icon rail on the right.
At narrower widths, preserve a usable map canvas first; drawers and inspectors
must stay within the viewport and retain a visible close control.

## Visual language

### Surfaces

- Dark map UI uses translucent blue-charcoal glass, a light hairline border,
  a soft shadow, and backdrop blur. A dark basemap needs a lifted tint in
  addition to blur so the surface remains recognisably translucent.
- Standard OSM requires the same hierarchy with enough text contrast over a
  lighter raster. Never rely on a particular map tile colour for legibility.
- Use modest radii (roughly 6–12 px), restrained shadows, and compact density.
  Cards are for grouping interactions or state, not for decorative repetition.

### Semantic colour

- `#38bdf8` / blue is the default focus and active-tool colour.
- `#facc15` / yellow is reserved for a chosen verified power line and both of
  its endpoint rings. The line uses a narrow core and low-opacity halo; do not
  combine it with a competing cyan selection stroke.
- Red is error-only. It must communicate a failed preparation or blocking
  action, never ordinary absence of data.
- Layer colours describe presentation semantics; they must not silently imply
  validation confidence or real-world authority.

### Typography and controls

- Use the existing Inter/system stack and the application's current compact
  hierarchy. Panel headings are clear but never dominate the map.
- Every icon-only action has an accessible name and visible focus state.
- Preserve readable wrapping for source IDs, endpoint evidence, and long OSM
  tags. Do not truncate evidence that changes the meaning of an action.

## Interaction patterns

### AOI preparation

- AOI settings open from the rail and can use point/radius or administrative
  PRG selection.
- A prepared AOI snapshot is a light-green boundary; a changed, unprepared
  point/radius or PRG selection is a dashed blue boundary. They may be visible
  together so a proposed replacement is never mistaken for downloaded data.
- Administrative camera behaviour is purposeful: a selected voivodeship uses
  zoom 7.5; a county or gmina uses zoom 9; the map centres on the selection.
- Runtime progress uses the versioned job-event contract. Loading, cache hit,
  per-domain work, publication, and failure must be distinct states. A partial
  snapshot remains publishable when one or more domains fail: completed layers
  stay visible, each failed domain shows its source-acquisition reason and a
  retry action that preserves the completed work.

### Feature inspection

- Clicking a delivered feature opens a MapLibre popup with source-backed
  attributes and safe external links.
- Roads, railways, rivers and canals use their delivered geometry as an
  invisible click target only. They have no map line, label, or selected-line
  highlight; the popup is the sole map interaction.
- Water, gas, sewer and district-heating pipelines retain visible source-line
  geometry and receive the selected-line highlight. Representative
  `*.inspection_points` records remain available in the provider pack/export
  but are never rendered as map markers.
- Point and area features use a high-contrast, domain-aware icon with a dark
  keyline and a distinct internal pictogram. Icons identify only the delivered
  normalized category or `asset_type`; unknown or mixed categories use an
  explicit generic symbol rather than inferred real-world semantics.
- The Layer Catalog and Legend reuse the exact map symbol assets. The Legend
  groups entries by domain and expands multi-type artifacts (such as power
  supports) into their individual visible symbols.
- The **Selected feature** drawer is read-only inspection context. It must not
  duplicate a primary map-popup action.
- Closing a map popup must clear its retained popup reference; subsequent data
  updates must not reopen a closed popup.
- The current zoom and any transport inspection threshold belong in the central
  bottom status strip, rather than in a separate map banner or corner badge.
- Map popups use a darker version of the shared glass surface: translucent
  enough to retain map context, but dark enough for dense source attributes.
  Long attribute content scrolls inside the popup rather than overflowing the
  viewport.

### Verified power circuits and lines

- Circuit and line choices use only the committed
  `presentations/power/.../circuits` endpoints and member geometries returned
  by that contract.
- The station or line popup is the sole selector. It labels delivered members
  as lines and includes their circuit and available endpoint evidence.
- Selecting a line highlights that line and its two source endpoints in yellow.
  It must not imply an electrical path, flow direction, or undisclosed network
  connectivity.
- If the initial bounded circuit-relation acquisition was unavailable, selecting
  a delivered station or line performs one narrow recovery request for that
  source feature only. A recovered private evidence artifact may add committed
  relations; a failed recovery remains explicitly unavailable and never
  fabricates circuit membership.
- A selected line opens the **Selected-line edge inspector**, anchored to the
  lower-right map edge. It shows circuit identity, voltage, evidence, a zoom
  action, and a close action that clears the circuit-line selection. It also
  loads and shows the selected line's source attributes (including `operator`)
  from its own feature-detail contract; circuit metadata never substitutes for
  line metadata.
- `Zoom to line` fits the delivered line geometry with map-safe padding; it
  does not route or infer a broader circuit extent.

### Panels and window behaviour

- Any drawer or floating window has a reliable visible close action.
- The Activity window is draggable and resizable while preserving its minimum
  readable size and staying inside the viewport.
- Opening a power feature should not force the Layers drawer open. The map
  popup is sufficient for the primary inspection flow.

## States and accessibility

- Loading, empty, unavailable, error, selected, and active states need visible
  copy or styling; do not leave an empty control with no explanation.
- Keyboard users can operate the rail, buttons, popup line choices, zoom, and
  close actions. Focus must remain visible on glass surfaces.
- Do not use colour as the sole signal for data source, readiness, or failure.
- Respect viewport size, long translated text, and OS/browser zoom. Persistent
  controls must not be clipped by a drawer, popup, or status strip.

## Visual-change protocol

1. Read this document and inspect the closest existing component and styles.
2. Preserve the provider, provenance, and reference-overlay boundaries.
3. Use a supplied screenshot or existing product screen as the visual target;
   do not invent a disconnected visual language.
4. Implement the smallest coherent change, including closed, loading, empty,
   error, focus, and selected states relevant to the interaction.
5. Run the affected checks (`npm run lint`, `npm test`, and `npm run build` for
   frontend changes) and inspect a rendered state when the required API is
   available.
6. Record visual QA in `design-qa.md`. A build or screenshot alone is not a
   visual sign-off.
7. Update this file when the change alters a durable rule, token, layout
   pattern, or interaction ownership. Use `docs/local/DECISIONS.md` as well
   only when the decision changes the wider product or architecture baseline.

## Non-goals

- No C2, incident-response, simulation, flow, routing, or cascade controls.
- No hidden elevation of WMS/KIUT/GESUT reference imagery to analytical data.
- No generic dashboard chrome that competes with the map or obscures data
  provenance.

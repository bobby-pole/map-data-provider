# Glass workspace visual QA

- Source visual truth: `/Users/robert/Downloads/minimalist_infrastructure_map_dashboard_v1.png`
- Implementation capture: `/private/tmp/mdq-standard-osm-activity.png`
- Comparison composite: `/private/tmp/mdq-glass-ui-comparison.png`
- Viewport: 1365 × 768 CSS px, device scale factor 1.
- State: dark OSM, AOI settings drawer open, no prepared AOI.

## Comparison history

1. The first 278 px drawer rendering exposed P1 horizontal overflow in the mode controls and header metadata. The grid tracks were changed to `minmax(0, 1fr)` and the panel metadata was removed from the header treatment.
2. The second rendering at the reference viewport confirmed that the drawer, its controls and the navigation rail remained within their containers. The provider-domain layout was changed to one column and the rail was adjusted to the reference height and right offset.
3. The supplied Tailwind/CSS reference was translated into the existing stylesheet: 320 px drawer width, `rgba(30, 35, 45, .4)` glass, 24 px blur, hairline borders, custom scrollbar and custom checkbox states. The wider panel and 13 px no-wrap mode controls removed the observed button-label truncation.
4. Standard OSM review showed that the former secondary-text token was insufficiently legible over a light base map. The shared muted token and drawer-specific helper text were raised to a light blue-gray. The Activity Log was rebuilt as a glass floating window with its own title bar, card-like events and matching scrollbar.

## Findings

No actionable P0, P1 or P2 differences remain for the requested visual surfaces.

- Fonts and typography: the compact Inter/system UI stack, 16 px panel heading, restrained metadata and small map status text preserve the reference hierarchy.
- Spacing and layout: the drawer is 320 px wide with a 12 px radius, 20 px left offset, 70 px top offset and a header divider. Its fields use bounded grid tracks and its mode labels have a fixed 13 px no-wrap treatment, so no control overflows at the reference viewport.
- Colors and visual tokens: the drawer uses the reference's translucent charcoal `rgba(30, 35, 45, .4)` glass, 24 px blur, light hairline border and soft shadow. The controls follow the reference's translucent button and dark-input tokens.
- Contrast and activity: helper text uses a high-contrast light blue-gray over Standard OSM. The Activity Log uses the same glass, border, typography, event cards and scrollbar treatment as the drawers.
- Image quality and asset fidelity: the application continues to render the live OSM map rather than substituting a static mockup image.
- Icons: the former custom SVG rail icons were replaced by a coherent Lucide line-icon family; the layers, filter, ruler, wrench and settings sequence follows the reference rail’s visual language.
- Copy and content: the AOI controls retain the product’s point/radius and PRG workflow. This differs from the reference’s abbreviated accordion copy but preserves the required application functionality.

## Primary interactions checked

- Opened the Layers panel through the right navigation rail and confirmed its active state and panel content.
- Reopened AOI settings through the rail and confirmed the reference state renders without overflow.
- Selected the `power` domain and confirmed the custom indigo checkbox and white checkmark state.
- Switched to Standard OSM and confirmed drawer copy remains readable; opened the Activity Log and confirmed four glass event cards render with no console warnings or errors.
- Checked browser console: no warnings or errors.

## Follow-up polish

- P3: the AOI workflow has more explanatory copy and selection controls than the illustrative mockup, intentionally retained for the real PRG workflow.

final result: passed

---

# Bottom-status zoom guidance QA

- The standalone top-centre transport zoom banner and lower-right zoom badge
  were removed.
- The central bottom status strip now includes the current zoom. When delivered
  road or railway layers need a closer view, it adds `Roads & rail: zoom 11+`.
- This keeps all persistent map context in one compact, non-interactive strip
  and clears the guidance automatically at zoom 11.

final result: implementation checks passed (frontend lint and production build); live visual replay remains available on the next local map session.

---

# Circuit popup interaction QA

- Source visual truth: `/Users/robert/Desktop/Zrzut ekranu 2026-08-14 o 13.32.13.png` and the three supplied OpenInfraMap reference captures from `2026-08-14 13.38`.
- Implementation capture: local browser preview at `http://127.0.0.1:5175/` (1680 × 884 px capture, device scale factor 1).
- State: the preview rendered the unprepared-AOI screen. The local browser session could not reach the provider API to load the supplied Rybnik snapshot, so the station-popup, relation-list and selected-line states could not be captured at the same map state.
- Intended implementation evidence: `frontend/src/components/MapView.tsx` now requests only the committed `circuits` endpoints, renders delivered members as the sole line selector in the map popup, places the selected-line inspector at the map edge with `Zoom to line`, and applies a restrained yellow line halo plus yellow endpoint rings. `FeatureDetails.tsx` is now read-only, so it cannot duplicate that selector. The station popup clears its retained reference when closed, preventing a later state update from reviving it.

## Findings

- [P1] The live selected-line state could not be compared visually with the OpenInfraMap references. The startup map shell rendered correctly, but the provider API was unavailable to the browser process, so no station or delivered line could be selected in this QA run.
  - Fix before visual sign-off: run the frontend alongside the provider API and open a prepared AOI, then repeat the station → line → zoom interaction at the reference viewport.

## Implementation checklist

1. Prepare or load a power AOI in the local preview.
2. Select a station, choose a committed line from its popup, and confirm the secondary popup and zoom action.
3. Check that only the chosen line and both endpoint rings are yellow, with no competing cyan highlight.

final result: blocked

---

# Partial AOI snapshot state QA

- Source state: user-provided failed AOI preparation capture from 2026-08-14.
- Verified interaction contract: a job that has one or more `failed` domain
  outcomes now publishes its completed layers, keeps the AOI settings drawer
  open, and displays the failed domain, retry state and source-acquisition
  reason in a text-labelled error surface.
- Retry behavior: reapplying the same AOI keeps cached successful domains and
  requests only the failed ones; this is covered by the worker regression test.
- Visual boundary: the new partial-snapshot treatment uses the existing
  error-only red token and text labels, so a source-acquisition failure is not
  mistaken for an empty analytical layer.

final result: verified by focused frontend tests and production build; live
browser replay awaits a reachable local provider API.

---

# Prepared versus draft AOI boundary QA

- A light-green solid boundary denotes the AOI snapshot that already has
  published provider domains.
- A dashed blue boundary denotes only a new, not-yet-published point/radius or
  PRG selection. It renders above the green snapshot boundary when both exist.
- The frontend regression test verifies that the two geometries remain
  separate; lint and production build pass.

final result: verified by focused frontend tests and production build.

---

# Popup-only networks and pipeline presentation QA

- Source state: user-provided transport-map capture from 2026-08-14 showing
  dense representative inspection markers.
- Roads, railways, waterways and canals now use a 14 px transparent MapLibre
  hit target at their existing inspection zoom. The target stays queryable for
  the normal popup, but has no visible line, label or selected-feature overlay.
- Water, gas, sewer and district-heating pipeline lines remain visible and
  retain the cyan selected-line highlight.
- `*.inspection_points` artifacts are deliberately absent from the map preview
  and Layers catalogue. The presentation filter leaves the source-backed pack
  and export contract unchanged.
- Focused Vitest coverage verifies the popup-only network classification and
  that inspection-point artifacts are not offered to the map renderer. ESLint
  and the production build pass.

final result: verified by focused frontend tests and production build; a live
prepared-AOI visual replay remains available for the next local provider run.

---

# Source-backed object-symbol and legend QA

- Source visual truth: the five user-provided Open Infrastructure Map captures
  from 2026-08-14, used only as interaction/symbology reference rather than as
  a source of copied icon artwork or panel styling.
- The preview uses repository-owned SVG pictograms with a dark keyline, white
  internal mark and domain-coloured field. The same asset is used by MapLibre,
  the Layers catalogue and the domain-grouped Legend.
- The renderer maps only delivered artifact categories and `power.supports`
  `asset_type` values to symbols; any unsupported category visibly falls back
  to a generic marker rather than claiming an inferred facility type.
- Focused Vitest tests cover category mapping, the power-support expression and
  shared asset generation. Frontend lint and production build pass.

final result: verified by focused frontend tests and production build; live
prepared-AOI visual replay awaits a reachable local provider API.

---

# Power-symbol and circuit-recovery QA

- Live AOI evidence: `aoi_fd39a57dbc8c48be` stored tower, portal and pole
  assets under `power.assets`, not the fixture-specific `power.supports`
  artifact. The map expression now matches these delivered `asset_type`
  values directly, so they no longer use the generic plus marker.
- The same snapshot recorded an explicit `availability=unavailable` relation
  artifact after an Overpass HTTP 429. Selecting `way/139452056` (SE Wielopole)
  triggered the bounded source-ID recovery and returned 16 committed circuit
  summaries, including 400 kV and 110 kV relations.
- The unavailable state remains a typed contract state and preserves its
  limitations if a targeted recovery also fails; no empty relation result is
  interpreted as evidence.

final result: verified by live selected-feature recovery, Node route/type tests,
focused frontend tests, lint and production builds.

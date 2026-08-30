# UI-GATE Candidate Accessibility and Design Audit

## Audit identity

- Issue: [#45](https://github.com/kyashp/shepherd/issues/45), `UI-GATE`
- Branch: `test/45-ui-gate`
- Rendered current-main candidate: `d41613b` (causal UI fixes at `bbc7c81`, refreshed through `origin/main` `0ed41dd`)
- Audit date: 2026-08-31
- Runtime: Node.js 24.16.0
- Browser: Google Chrome for Testing 151.0.7922.34, Playwright, one worker
- Viewports: 1280x800 and 1440x900
- Reviewed corpus: 36 PNGs, 18 named stages per viewport, 3,229,473 bytes total
- Evidence command: `E2E_UPDATE_EVIDENCE=true node node_modules/@playwright/test/cli.js test tests/e2e/ui-gate.spec.mjs --workers=1`
- Ordinary-run boundary: screenshots remain under `.tmp/playwright-evidence/ui-gate/`; only the explicit environment value `true` copies them into this reviewed directory.

The explicit evidence run passed 12/12 tests. Every PNG is non-empty, has its declared dimensions, and belongs to the expected 18-file manifest for its viewport; there are no extra or non-PNG artifacts in the corpus. The positive journeys use the real compiled local server and deterministic public APIs. Request interception is limited to holding or failing real reads to expose loading and reconnect states.

## Gate status

| Gate | Candidate status | What is and is not claimed |
| --- | --- | --- |
| `C` candidate checks | Local UI-gate, adjacent Web tests, strict Web typecheck, and Web/Server builds passed. Hosted run `33329417868` passed on evidence commit `38ac907`; an exact post-main-refresh head check is pending. | The candidate is not complete until the final pushed commit is green in hosted CI. |
| `B` browser evidence | Automated Chromium journeys passed at both exact viewports and all 36 images were inspected against `docs/UI.jpeg`. | The product browser path is directly observed. A separate live inspection through the in-app browser was unavailable because no browser session was connected. |
| `U` independent usability | Pending. | This implementation-owner review is not an independent approval. |
| `I` final integration | Pending. | The corpus must be regenerated and the gate rerun on the exact protected-main integration head. |

## Six-surface matrix

Each filename below exists beneath both `1280x800/` and `1440x900/`.

| PRD surface | Evidence | Direct assertions |
| --- | --- | --- |
| Sidebar and primary navigation | `03-agents-empty.png`, `07-not-found.png`, `11-shepherd-active.png`, `18-group-message.png` | Complementary, main, and three named navigation landmarks are present; current-route styling is exposed; named links receive visible focus; sidebar navigation and recovery are activated with Enter; long Agent labels truncate only in the sidebar while the page exposes the full value. |
| Shepherd Execution Contract Stream | `09-shepherd-empty.png`, `10-shepherd-reconnecting.png`, `11-shepherd-active.png`, `12-shepherd-filtered.png` | Empty, stale/reconnecting, populated, and filtered states are visible; real Mission state produces 33 bounded events; filters activate by keyboard and expose `aria-pressed`; the event list owns its overflow. |
| Shepherd Live Execution Timeline | `09-shepherd-empty.png`, `11-shepherd-active.png`, `12-shepherd-filtered.png` | Waiting and completed states render from real state; Agent and Resolution rows remain readable; the timeline pane owns any overflow and does not widen the document. |
| Shepherd Plane Tree and detail drawer | `09-shepherd-empty.png`, `11-shepherd-active.png`, `13-plane-drawer.png` | Empty and five-Plane populated states render; a tree-node button opens with Enter; shortened Plane IDs expose the full ID through `title`; the labelled non-modal dialog focuses Close on open; evidence tabs use roving keyboard selection; Escape closes and restores focus to the opener; the tree and drawer own their scroll. |
| Project Group conversation and composer | `14-group-uninitialized.png` through `18-group-message.png` | Uninitialized, loading, empty, reconnect, pending-send, and persisted-message states are covered; composer/send/mention controls are disabled when unavailable; Enter submits exactly once; the real targeted message persists without creating a Mission; 1,900-character unbroken messages wrap and remain singular after polling; the message pane owns vertical scroll. |
| Agent experience and Create/Edit configuration | `03-agents-empty.png`, `04-agent-create-disabled.png`, `05-agent-long-content.png` | Empty list and Create flow render; required submit is visibly and semantically disabled; initial focus is on the labelled name input; an 80-character unbroken name wraps without document overflow; Edit preserves the full name, Save persists the description, and Stop/Start return the Agent to a ready route. |

Adjacent evidence is `01-auth-loading.png` and `02-auth-error.png` for authentication, `06-settings-disabled.png` for Settings, and `07-not-found.png` for route recovery.

## Keyboard and focus results

| Interaction | Observed result |
| --- | --- |
| Global navigation | Native named links receive the shared 2px visible focus outline. The Your Agents link and not-found Open Shepherd recovery link activate with Enter and land on the expected headings. |
| Settings tabs | Exactly one tab has `tabindex=0`. ArrowRight selects/focuses Execution; End selects/focuses Notifications; Home returns to General; ArrowLeft wraps to Notifications. Every tab has an ID and `aria-controls`; the one rendered tabpanel has the reciprocal ID and `aria-labelledby`. |
| Contract filters | Each named filter receives visible focus, activates with Enter, sets `aria-pressed=true`, and leaves a visible filtered event. |
| Plane tree | The selected Plane button receives visible focus and opens the detail dialog with Enter. The current tree is a static hierarchy of named buttons, not a collapsible ARIA tree, so no unsupported expanded state is claimed. |
| Drawer | Close receives initial focus. ArrowRight moves selection from Candidate verification to Final promotion re-verification. Escape closes the non-modal dialog and restores focus to the exact Plane opener; no trap was observed. |
| Project Group composer | The labelled textarea submits on Enter, is disabled before initialization and during the held POST, and produces exactly one request/message. Mention insertion preserves the draft and becomes disabled with a non-color cursor/opacity cue while unavailable. |
| Recovery | The labelled Open Shepherd link has the expected `/shepherd` destination, a visible focus indicator, and works with Enter. Authentication required-value feedback is native and the invalid-token error is announced as an alert. |

Focus order followed the visual order in the exercised flows. Focus never disappeared behind an overlay, and drawer close/restoration was deterministic. Programmatic focus assertions verify a non-zero outline or box shadow and an accessible name; they do not substitute for assistive-technology observation.

## Semantics, status, and input feedback

- The shell exposes complementary and main landmarks plus separately named Shepherd, Project Group, and Agents navigation landmarks.
- Primary regions and panel headings are associated through native headings and `aria-labelledby`.
- Authentication failure uses `role=alert`; reconnecting and retry copy uses status semantics while preserving the last confirmed content.
- Settings and drawer evidence controls use tabs, selected state, roving tab stops, and reciprocal tab/tabpanel relationships.
- Filters expose pressed state. Native disabled state is present on unavailable buttons, checkboxes, composer, send, and mention controls; disabled appearance also changes opacity/cursor rather than relying on color alone.
- The Plane detail is a labelled `role=dialog` with `aria-modal=false`, matching its non-blocking drawer behavior.
- Required Access token input has an associated label and native `valueMissing` feedback. Invalid credentials produce bounded, actionable copy without exposing the token.
- User-controlled Project Group content contains no executable descendant or inline event attribute. Bounded public DOM/API/log canary scans passed without exposing tokens, raw prompts, private paths, or seeded private markers.

## Contrast and target sizing

Ratios use the WCAG relative-luminance formula implemented by the gate and the computed CSS pairs exercised by the screenshots.

| Treatment | Pair | Ratio | Result |
| --- | --- | --- | --- |
| Muted authentication copy | `#6f7069` on `#fbfaf7` | 4.79:1 | Passes 4.5:1 normal-text threshold. |
| Muted empty-state copy | `#6f7069` on white | 5.00:1 | Passes 4.5:1 normal-text threshold. |
| Authentication error | `#9e4141` on `#fae8e6` | 5.40:1 | Passes 4.5:1 and is also identified by alert text/border. |
| Primary button text | white on `#6954d9` | 5.43:1 | Passes 4.5:1 before any disabled opacity treatment. |
| Focus outline on paper | `#8773e8` on `#fbfaf7` | 3.56:1 | Passes 3:1 non-text threshold. |
| Focus outline on sidebar | `#8773e8` on `#242421` | 4.19:1 | Passes 3:1 non-text threshold. |
| Mention-chip text | `#5e4ab7` on `#f0edfa` | 5.80:1 | Passes 4.5:1. |
| Disabled send glyph/text | `#9c9b95` on `#d8d6cf` | 1.92:1 | Disabled controls are exempt from 1.4.3/1.4.11; native disabled state, reduced opacity, and `not-allowed` cursor provide the unavailable cue. No enabled-state pass is inferred from this pair. |

The Project Group mention chips are 25 CSS pixels high, below the preferred 44x44 touch target. This is a documented WCAG 2.5.5 exception for compact, repeated, desktop-only routing chips in a horizontally scrollable member rail. The primary actions and touch-oriented controls retain the larger control treatment. This exception is not a general target-size pass.

## Overflow and responsive behavior

- Both document and body remained at the viewport width and height within the one-pixel rounding tolerance at both sizes.
- The event list, timeline, Plane tree, detail drawer, Project Group member rail, and message history are the named internal scroll owners. Programmatic one-pixel scroll probes confirm that an overflowing pane can actually scroll without changing document width.
- The 80-character Agent name wraps across lines, remains fully available in its heading, and no longer creates the former 5px document Y overflow at 1280x800.
- Two 1,900-character unbroken Project Group messages use `overflow-wrap:anywhere`, stay within the message bubble, and make only the message history scroll.
- The Create Agent form is intentionally dense and requires vertical scrolling at 1280x800; the same action footer is visible without scrolling at 1440x900. A future design pass could consider a sticky action footer, but this is not an obstruction or document-overflow defect.
- The focused drawer screenshot is scrolled to the resolution-evidence tabs, so its header is outside that image's visible drawer segment. Separate DOM assertions cover the labelled dialog, Close control, focus entry, Escape close, and restoration. A final independent live review should inspect the complete drawer sequence.

## State coverage

| State | Result |
| --- | --- |
| Loading | Authentication, Shepherd, and Project Group loading copy and spinners are visible without layout shift or a false ready state. |
| Empty | Agents, Contract Stream, Timeline, Plane Tree, and initialized Project Group provide specific next-step copy rather than blank panels. |
| Error and reconnect | Invalid auth is bounded and actionable. Shepherd and Project Group preserve last-confirmed content, identify reconnection, recover automatically after the real read succeeds, and remove the stale status. |
| Disabled | Create, Settings, unavailable notification/model toggles, Project Group composer/send, and mention controls expose native disabled state plus visible treatment. No-op Settings Discard is disabled. |
| Not found | A centered, named recovery action returns to Shepherd by keyboard. |
| Active and long content | Real Mission/collision/candidate/promotion state and persisted Project Group messages remain legible, internally scrollable, and canary-free. |

## Design critique

The candidate is faithful to the accepted Launchpad reference: the charcoal sidebar, cream paper surfaces, restrained purple accent, compact rounded panels, green/red semantic colors, typography, spacing, borders, and shadows remain consistent across happy and non-happy paths. Headings and primary actions establish a clear hierarchy; reconnect banners and state pills add meaning without overpowering the work surfaces. Empty states use one icon, one short heading, and actionable copy, and dense Shepherd data remains divided into three stable regions.

No High or Medium visual/accessibility defect was found in the reviewed corpus. The remaining Low observations are the 1280x800 Create Agent scroll depth, the intentionally compact mention-chip target exception, and the drawer evidence image's focused scroll position. These are recorded for independent review rather than hidden or promoted to a fabricated pass.

## Limitations and required follow-up

- No manual screen-reader session was run. Names, roles, relationships, focus, and live-state assertions are DOM evidence, not a substitute for NVDA, JAWS, VoiceOver, or another assistive technology.
- The product was exercised in Playwright Chromium, but the in-app browser connector reported no available browser session. No separate in-app live visual claim is made.
- The literal local Node harness reproduced the documented Windows `spawn EFTYPE` boundary: 15/19 passed and the four process-spawn cases failed. This is not recorded as a harness pass; hosted Linux CI remains required on the exact final commit.
- This is an implementation-owner candidate audit. An independent reviewer must perform and record the `U` gate.
- Hosted CI must pass on the exact final pushed commit before `C` becomes complete.
- Protected-main integration, evidence regeneration, and exact integrated rerun remain required for `I`.

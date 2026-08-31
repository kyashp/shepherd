# Shepherd release test report

**Observed:** 2026-08-31, Asia/Singapore

**Protected-main base before remediation:** `f935fdb5581849f8377f20922e254c55d34e5de0`

**Tested product commit:** `223a5fe00f977013d4bf5df6560016a1719c8d11`

**Integrated merge:** `53f252935f63f4bef8a36f17432fecd0de824181`

**Delivery:** [issue #96](https://github.com/kyashp/shepherd/issues/96) /
[merged PR #97](https://github.com/kyashp/shepherd/pull/97)

This report records commands actually observed in a clean worktree on the exact
protected-main merge. It does not claim independent security/UI review, a paid
provider request, or a complete demo rehearsal.

## Environment

| Component | Observed version |
|---|---|
| macOS host | `26.5.2` / `arm64` |
| Node.js | `v26.5.0` |
| npm | `11.17.0` |
| Playwright | `1.62.1` |
| Docker client/server | `29.6.1` / `29.6.1` |
| Terraform validator | pinned `hashicorp/terraform:1.9.8` container |
| Volcengine provider | `volcengine/volcenginecc` `0.0.58` |

## Final observed matrix

| Gate | Result | Scope |
|---|---:|---|
| `npm run check` | Pass | root Node tests 26/26; Server 856 passed and 3 explicit opt-in skips; Web 20/20; strict production/test typechecks; Web and Server production builds |
| `npm run test:coverage` | Pass | Server: 86.15% statements, 80.05% branches, 91.46% functions, 88.03% lines. Browser: 88.40% statements, 80.00% branches, 87.35% functions, 92.37% lines. Every production source file is required; all four thresholds are 80%. |
| full Playwright matrix | Pass, 48/48 | 24 functional flows at both `1280x800` and `1440x900`, one worker, normal non-instrumented production build |
| `npm run test:terraform` | Pass | formats, initializes, and validates a disposable module copy with the pinned Terraform image; working tree is not populated with provider state |
| `npm run test:shepherd:live:preflight` | Pass | builds the exact merged Runtime and non-root controller images, uses a named state volume and engine socket, discovers exactly one live test, and cleans temporary resources; no model request |
| `npm audit --json` | Pass | 0 vulnerabilities |
| `git diff --check` and bounded secret scan | Pass | no whitespace error, tracked credential, state, or generated Terraform artifact found |
| hosted protected-main workflow | Pass | `Required checks` push run `33396729636` completed successfully on exact merge `53f2529` |

The clean coverage run executes the complete Server suite first, then rebuilds the
Web app with browser instrumentation and runs 24 Chromium flows. It restores the
ordinary production build before exit. The browser release matrix was then run
separately at both required viewports, so the 48/48 result is not an
instrumentation-only observation.

## Failures found and corrected

The first exact-main browser matrix passed 34/38. The audit then reproduced and
fixed the underlying defects rather than weakening assertions:

- Project Group could lose a fast typed character or move the caret because a
  controlled input update raced the mention action.
- Agent edit could render before authority presets and Agent state had hydrated;
  a rapid custom-authority toggle could then erase edited values.
- the accepted shell could acquire a one-pixel document scroll, and Settings icon
  buttons lacked explicit accessible names.
- durable collections were unbounded and Agent creation could partially publish;
  capacity now fails with a bounded `507` and creation is atomic.
- a tokenless server had no loopback Host/same-origin Origin boundary, and public
  binds could start without a token.
- the live gate forced host bind mounts, did not build the exact working tree, and
  could not cross the documented macOS Docker Desktop sandbox boundary.
- no executable coverage provider/threshold or reproducible Terraform validator
  existed.
- runtime credentials could enter Terraform input, cloud-init, plan, and state.

Causal regression coverage was added for each corrected behavior. The accepted UI
theme and layout were preserved.

## Explicitly incomplete evidence

- **External Ark inference:** not executed in this audit. The live command sends
  repository-derived prompts and code to the configured Ark endpoint. The local
  execution environment requires a separate informed approval for that data
  transfer. The zero-spend exact-tree Docker preflight passes, so the earlier
  host-share sandbox-probe blocker is no longer the current blocker.
- **Independent review:** issue #45's read-only UI review and issue #89's required
  independent security review cannot be self-certified by the author of this
  remediation. The deterministic UI and security regressions pass locally.
- **Rehearsal/delivery:** three clean timed demo rehearsals and any genuinely
  available second-machine run remain separate evidence work. This report does not
  infer them from automated tests.

## Reproduction

```bash
npm ci
npm run check
npm run test:coverage
PLAYWRIGHT_BROWSERS_PATH=/path/to/browser-cache \
  ./node_modules/.bin/playwright test --config=playwright.config.ts
npm run test:terraform
npm run test:shepherd:live:preflight
npm audit --json
```

The live provider gate is intentionally omitted from the default sequence. Run it
only with the documented opt-in, configured ignored environment file, bounded test
scope, and authorization to send repository-derived payloads externally.

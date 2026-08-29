## Work item

- HANDOVER ID:
- Linked issue:
- PRD reference(s):
- Head branch:
- Base branch / stack parent:
- Depends on:
- Blocks:
- Owned files/modules:

Mid-stack PRs must be manually linked to their issue. Do not rely on a closing keyword until the PR targets `main`.

## Outcome and minimal scope

Describe the user-visible or trusted-boundary outcome and why this is the smallest coherent change. List intentionally excluded adjacent work.

## Acceptance evidence

Record exact commands and observed outcomes. Do not write "should pass" or copy evidence from another commit.

```text
command
observed result
```

- [ ] Targeted regression tests passed.
- [ ] Adjacent tests passed.
- [ ] `npm run check` passed, or the exact justified subset is recorded.
- [ ] Negative/failure cases required by the issue passed.
- [ ] Documentation and `docs/BUILD_LOG.md` were updated when behavior/evidence changed.
- [ ] No secrets, local state, generated workspaces, or unbounded outputs are included.

## UI evidence, when applicable

- [ ] Real browser interaction was completed.
- [ ] 1280x800 and 1440x900 screenshots were reviewed against `docs/UI.jpeg` and PRD 11.7.
- [ ] Loading, empty, error, disabled, reconnecting, overflow, keyboard, and focus states were checked as applicable.
- [ ] Independent UI review completed; material findings are resolved or explicitly blocking.

## Security and integration evidence, when applicable

- [ ] Authority, redaction, path, persistence, cancellation, public API, file handling, or model-controlled actions received independent security review.
- [ ] Deterministic tests prove safe behavior without external services.
- [ ] Any live model/API smoke was opt-in, bounded, and recorded without credentials.

## Scoped verdict

- Confidence (0-100):
- Why this score is justified:
- Remaining uncertainty:
- Review required because confidence is below 100: yes / no
- Ready-for-review SHA:

`100` means only that every defined acceptance criterion, required test, independent review, and pre-merge gate passed for this PR's scope. It never means that unknown defects are impossible.

## Post-merge verification

- [ ] Required checks passed in the merge queue or against the final merge group.
- [ ] The relevant smoke/flow passed on updated `main`.
- [ ] The issue and HANDOVER ledger were updated from evidence at the merged SHA.

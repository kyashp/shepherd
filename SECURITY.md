# Security policy

Volc Agent Launchpad is a hackathon proof of concept. Only the latest revision
on the default branch is supported.

Shepherd adds stricter authority, Git Plane, verifier, redaction, and promotion
boundaries for its managed demo project. These do not turn the broader Starter
Kit into a production identity or tenant-isolation system. Current security
evidence and pending review are tracked in [docs/TASKS.md](docs/TASKS.md), with
material interpretations in [docs/DEVIATIONS.md](docs/DEVIATIONS.md).

## Report a vulnerability

Send the repository owner or event organizer the affected revision,
reproduction steps, impact, and suggested mitigation. Do not publish
credentials, personal data, or exploit details in an issue.

## Known limitations

- Shared demo token; no user identity, authorization, RBAC, or tenant isolation
- No CSRF protection
- No per-Agent container boundary in ECS mode
- Ordinary local containers, not hardened multi-tenant sandboxes
- Broad outbound network access
- Prompt-triggered command and file execution
- Control plane holds the container engine socket in `container-volume` mode, which is equivalent to control of the engine; see `docs/DEVIATIONS.md`
- Ark key available to the server and active Runtime container
- Ark key stored in Terraform POC state

## Safe use

- Use a dedicated development machine or disposable ECS instance.
- Use a scoped, revocable Ark key.
- `APP_AUTH_TOKEN` is optional and empty by default, so a server started without
  one serves every API route to anyone who can reach the port. That is acceptable
  on loopback. Set a unique token before exposing the server beyond the local
  machine, including any ECS deployment.
- Keep local use on loopback and restrict ECS Web and SSH CIDRs.
- Add HTTPS before sending a shared token over an untrusted network.
- Never mount production data or provide Volcengine account AK/SK to Agents.
- Stop the POC, destroy test resources, and revoke keys after the event.

Codex uses `workspace-write` when Landlock is available. On unsupported kernels,
startup warns and relies on the outer Docker or rootless Podman boundary. This
fallback is not tenant isolation.

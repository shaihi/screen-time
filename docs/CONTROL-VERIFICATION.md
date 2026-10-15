# Control branch verification — 2026-10-15

Branch: `feat/windows-screen-time-enforcement`.

## Development checks

- `pnpm test`: 71 passed, including isolated PostgreSQL-compatible database tests.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build`: passed.
- `dotnet test agent/ScreenTime.Control.Tests/ScreenTime.Control.Tests.csproj`: 52 passed, including Node/.NET signed-policy and Unicode request-authentication interoperability fixtures.
- `dotnet test agent/ScreenTime.Agent.Tests/ScreenTime.Agent.Tests.csproj`: 96 passed.
- Built self-contained Windows x64 service and tray executables. The Mac's Homebrew .NET SDK lacks WindowsDesktop targets; the tray build uses the separately prepared .NET 8.0.426 SDK with WindowsDesktop targets. Windows CI runs the normal packaging script and PowerShell syntax checks.
- Ten HTTP checks against an isolated local production server passed: unauthenticated parent writes, spoofed household header, cross-origin request, insecure device enrollment/sync, and control response cache headers.
- Independent shared-Chrome verification passed for the real unconfigured-controls notice and existing dashboard. At 390px mobile width, neither the document nor body overflowed horizontally. Old browser-only fixture routes were removed before verification. This is not a live enrolled-device UI test.
- Staged-source privacy scan and whitespace checks passed. Protocol fixtures contain a public key and deterministic dummy credentials, not a deployment private key.

## Deployment and Windows acceptance

No production database migration, dashboard deployment, device enrollment, or Windows account change was performed as part of these checks.

The package starts in Watch only mode. Before enabling enforced mode, follow [START-HERE.md](START-HERE.md), especially Part 5 and offline rescue. Verify on the actual Windows 11 Pro PC:

1. Installation and sensor startup under the child's standard account.
2. Warning, cutoff, sign-out, and rejected PIN/password sign-in while blocked.
3. Parent Administrator access and offline recovery.
4. Extra time and restoration of child access after confirmed policy application.
5. Reboot, offline use, sleep across cutoff, retained usage, and the service-startup gap.

Passing these development checks does not establish that Windows sign-in blocking works on the target PC. The branch is ready for supervised installation and acceptance testing.

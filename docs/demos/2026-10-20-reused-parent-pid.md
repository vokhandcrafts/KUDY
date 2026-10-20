# Reused parent PID is not an ancestor

*2026-10-20T17:36:18Z by Showboat 0.6.1*
<!-- showboat-id: 04fc4b51-1830-4342-b336-5234eb68f444 -->

Windows keeps a stale ParentProcessId after the parent exits; a newer process with that id must not count as an ancestor. The test fakes the process table and runs the real Test-ProcessDescendant.

```bash
node --test --test-name-pattern "Test-ProcessDescendant" tools/android-build/emulator-scenarios.test.mjs 2>&1 | grep -E "^(✔|✖) " | sed -E "s/ \([0-9.]+ms\)//"
```

```output
✔ Test-ProcessDescendant: a reused parent id (parent newer than the child) is not an ancestor
```

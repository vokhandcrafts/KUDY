# G21.27 — гейт паходжання тэрмінаў пры няпэўнасці

*2026-10-04T23:49:12Z by Showboat 0.6.1*
<!-- showboat-id: f4e66c3e-8b66-4a34-b037-ef4c15cb42bc -->

G21.27 (issue #566): паходжанне тэрмінаў у запісах перакладу. Гейт выпушчаных моў цяпер патрабуе поўны след вырашанага пошуку (зацверджаная крыніца з рашэнняў G21.33), блакуе публікацыю радка з сумленна невырашаным (unresolved) тэрмінам і адхіляе след з недазволенай крыніцай. Дэма праганяе іменаваныя тэсты кантракту і гейта на кантраляваных фікстурах (рэальнае дрэва не мяняецца) і завяршае жывым запускам гейта на рэальным дрэве.

```python
import os, pathlib, subprocess, sys
sys.stdout.reconfigure(encoding='utf-8', newline='\n')
root = pathlib.Path.cwd()
# The host profile points LD_LIBRARY_PATH at an AppImage mount without the
# node libsimdjson dependency; the pinned copy lives in ~/.local/lib.
env = dict(os.environ)
env['LD_LIBRARY_PATH'] = str(pathlib.Path.home() / '.local' / 'lib')
run = subprocess.run(
    ['node', '--experimental-strip-types', '--test', '--test-reporter', 'tap',
     'contracts/ui-messages/translations.test.mjs', 'tools/i18n/check-messages.test.mjs'],
    capture_output=True, text=True, encoding='utf-8', cwd=root, env=env)
assert run.returncode == 0, run.stdout[-2000:] + run.stderr[-2000:]
plan = None
for line in run.stdout.splitlines():
    if line.startswith('1..'):
        plan = line
    if line.startswith(('ok ', 'not ok ')) and ('terminology' in line or 'unresolved' in line):
        print(line)
print(plan)
gate = subprocess.run(
    ['node', '--experimental-strip-types', 'tools/i18n/check-messages.mjs'],
    capture_output=True, text=True, encoding='utf-8', cwd=root, env=env)
assert gate.returncode == 0, gate.stdout + gate.stderr
print(gate.stdout.strip())
```

```output
ok 14 - terminology_trace_required: a resolved lookup carries source, locator, term and date
ok 15 - terminology_trace_required: cited reviewed terminology needs locator and term
ok 16 - terminology_trace_required: a reviewer judgment still names the chosen term
ok 17 - an unresolved uncertainty is contract-legal — the gate, not the contract, blocks publication
ok 18 - terminology shape violations answer with named schema diagnostics
ok 30 - terminology_provenance_resolved: a fully traced approved lookup passes the gate
ok 31 - terminology_unresolved_blocks_publication: an unresolved uncertainty stops the message
ok 32 - terminology_unsupported_reference: a looked-up trace citing a non-approved source fails
ok 33 - terminology_decisions_unavailable: an unreadable decisions file fails closed
1..37
check-messages: shipped locales complete, reviewed and fresh
```

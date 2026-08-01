# Master prompt · iterating on the WiFi Odds extension without a human in the loop

Paste this into any agent session (Claude, Codex, or another) that needs to change the extension and
see the change in a real browser. It is written to be self-contained.

---

## The trap this exists to remove

**Chrome pins an unpacked extension's code at load time.** Editing a file changes nothing in the
browser. Opening a new tab changes nothing. Navigating changes nothing. The browser keeps executing
the build it read when it was loaded, and **nothing on screen says so**.

That is not merely slow, it is a correctness problem. You will read a page, see old behaviour, and
conclude your change did not work, or worse, take a screenshot of a build that no longer exists and
file it as evidence. Both happened on 1 Aug 2026.

`chrome://extensions` is unreachable from browser-automation tools, so the reload cannot be clicked
by an agent. The bridge below is the way around it.

## One-time setup, needs a human once

1. `node ~/Projects/united-starlink-companion/dev/reload-server.mjs` (leave running)
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
   `~/Projects/united-starlink-companion/dev/reloader-extension`

This is a SEPARATE extension named "WiFi Odds dev reloader". It is not a refresh of the product
extension and cannot be created by refreshing anything. Confirm with:

    curl -s localhost:8391/status     # lastCheckIn must be non-null

## The loop, every time you change extension code

    # 1. edit files under extension/
    # 2. reload the extension in the real browser, and WAIT for the result
    curl -s -X POST localhost:8391/reload
    # → {"ok":true,"reloaded":["<id> v3.0.0"]}   proceed
    # → {"ok":false,...}                          STOP, do not trust what you see next
    # 3. reload the page under test, THEN read it

**Check the response.** If it is not `ok:true`, the browser is still running old code and every
observation you make afterwards is worthless. Do not proceed on hope.

## Verifying you are actually on new code

Never assume the reload worked. Assert on something only the new build produces:

    # example: after adding a label, confirm the label is really there
    document.querySelectorAll('.usl-metrics')[0].innerText

If you cannot name a visible difference your change should produce, you cannot verify the reload,
and you should say so rather than claiming the change is live.

## Hard rules for this repository

- **Desktop Commander only** for files and shell in `~/Projects/*`. The built-in Read/Write/Edit/Bash
  tools are scoped elsewhere and pop a folder-permission dialog. In an unattended run that dialog is
  fatal: nobody is awake to answer it. Never call `request_cowork_directory`.
- **Never `git add .`** The tree holds other people's drafts. Stage by explicit path. The three
  `extension/icons/icon*.png` changes are pre-existing and must stay unstaged.
- **Check which branch you are on before you push.** Another agent may have moved you. `git push
  origin main` pushes the *local* `main` ref, which succeeds and publishes nothing if your commits
  are on a side branch. This happened on 1 Aug; the fix is `git branch --show-current` first.
- **Read exit codes bare.** `cmd | tail` reports `tail`'s status, not `cmd`'s.
- **Re-measure hashes, never quote them from your own earlier notes.** A hash from before the last
  commit is stale even when the gate is green. This also happened on 1 Aug.
- **The builder never closes a finding.** Ship the fix, request verification, leave it OPEN.
- **Never upload to the Chrome Web Store.** That is Jeremy's manual action, always.

## The gates, and what each one is for

    sh build-airlines-parity.sh     # extension airline data == the site's model (byte + semantic)
    node test/phase2-e2e.mjs        # 26 browser cases, ~8 min, expect exit 0
    node test/mutation-matrix.mjs   # 14 deliberate regressions must each land AND be caught, ~25 min
    sh build-store-zip.sh           # package from HEAD:extension, + dev-bridge leak assertions
    sh build-store-verify.sh        # committed artifacts == HEAD, bundle embeds them, copy == product

Run long ones with `nohup … > /tmp/x.log 2>&1 &` and poll the log; a single tool call will time out.

A mutation that does not LAND is not a pass, it is a broken instrument. The matrix enforces this;
respect it rather than routing around it.

## Where the exchange lives

Extension work goes to `~/Projects/wifiodds-relay/exchange/from-builder/` as
`AUDIT-BRIEF-ROUND-<N>-<date>.md`, with `Baseline:` / `Scope:` / `Verdict:` headers and every claim
labelled Measured / Observed / Inferred / Reported. Codex polls that folder against
`.auditor-last-processed`; the new file IS the handoff, no signal line needed. The older
`~/wifiodds-exchange/` is the SITE track and has different numbering — a brief filed only there will
never be read.

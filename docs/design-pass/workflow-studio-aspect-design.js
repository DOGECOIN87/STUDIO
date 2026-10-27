export const meta = {
  name: 'studio-area-routed',
  description: 'One Audius Studio UI area: Haiku scans, Sonnet confirms, patches in worktrees and verifies, plain JS routes; Opus reviews after',
  whenToUse: 'Design or fix one UI area of Audius Studio at a time. The main session (Opus) reviews the returned patch and screenshots and approves before anything is committed.',
  phases: [
    { title: 'Scan', detail: 'Haiku scanners, one per file slice and per viewport (read-only)', model: 'haiku' },
    { title: 'Triage', detail: 'Haiku sorts candidates: this area, a later area, or noise; names duplicates', model: 'haiku' },
    { title: 'Confirm', detail: 'one Sonnet verifier per in-scope high/medium issue', model: 'sonnet' },
    { title: 'Spec', detail: 'Sonnet drafts the build spec (skipped when a spec file is given)', model: 'sonnet' },
    { title: 'Patch', detail: 'Sonnet builds in its own worktree and hands back a patch', model: 'sonnet' },
    { title: 'Verify', detail: 'Sonnet checks the patch in its own worktrees, then one verifier per issue', model: 'sonnet' },
    { title: 'Fix', detail: 'Sonnet fixes confirmed issues in a fresh worktree; stops after two rounds without progress', model: 'sonnet' },
    { title: 'Screens', detail: 'Haiku captures the before/after screenshots', model: 'haiku' },
  ],
}

// ---------------------------------------------------------------------------
// args: { key, title, scope, focus, windows: [...], specFile?: absolute path,
//         maxRounds?: number (default 5) }
// Model routing (CLAUDE.md): read-only scans -> haiku; confirm, patch, verify,
// fix -> sonnet; the main session (opus) only writes this script and reviews.
// Everything else below is plain JavaScript: slicing, ports, dedupe, routing,
// retries and stop conditions never cost a model call.
// ---------------------------------------------------------------------------
const A = args
const REPO = '/home/user/DAW'
const SP = '/tmp/claude-0/-home-user-DAW/717ea5f2-42d2-5656-8044-03574a727b85/scratchpad'
const IMP = '/home/user/dogecoin87/impeccable/plugin/skills/impeccable'
const HARNESS = `${REPO}/docs/design-pass/harness/lib.cjs`
const WORK = `${SP}/design/work/${A.key}`
const OUT = `${SP}/design/shots/${A.key}`
const BASE_URL = 'http://127.0.0.1:8767/' // main checkout, unchanged baseline (the lead starts it)
const MAX_ROUNDS = A.maxRounds || 5
const STALL_LIMIT = 2

// ---- plain-JS routing helpers ----------------------------------------------
const PORTS = { patch: 8801, verify: 8811, fix: 8841, confirm: 8861, screens: 8899 }
let portSeq = 0
const nextPort = base => base + (portSeq++ % 18) // unique per concurrent agent in a phase
const SEVERITY_RANK = { blocker: 3, major: 2, minor: 1, high: 3, medium: 2, low: 1 }
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9#.\-_ ]/g, '').replace(/\s+/g, ' ').trim()
const issueKey = i => `${norm(i.where || i.selector || '')}|${norm(i.title || i.description).slice(0, 48)}`
function dedupe(list) {
  const seen = new Map()
  for (const i of list) {
    const k = issueKey(i)
    const prev = seen.get(k)
    if (!prev || (SEVERITY_RANK[i.severity] || 0) > (SEVERITY_RANK[prev.severity] || 0)) seen.set(k, i)
  }
  return [...seen.values()]
}
const serious = list => list.filter(i => (SEVERITY_RANK[i.severity] || 0) >= 2)

// File slices for the code scanners (line ranges; a slice past the end of a file returns nothing).
const SLICES = [
  { file: 'app/public/index.html', from: 1, to: 1000 },
  ...Array.from({ length: 8 }, (_, i) => ({ file: 'app/public/styles.css', from: i * 700 + 1, to: (i + 1) * 700 })),
  ...Array.from({ length: 8 }, (_, i) => ({ file: 'app/public/app.js', from: i * 700 + 1, to: (i + 1) * 700 })),
]
const VIEWPORTS = ['1920x1080', '1366x768', '1024x1366t', '360x640t', '640x360t']

// ---- shared context --------------------------------------------------------
const COMMON = `
CONTEXT
- Audius Studio: a browser DAW, an unofficial community-built app for the Audius community (never imply it is official). Read ${REPO}/PRODUCT.md and ${REPO}/CLAUDE.md. If ${REPO}/DESIGN.md exists it is the design system.
- Owner's direction: "Elevate the Audius look": keep the Audius dark-purple brand and Avenir Next, then add pro-studio craft: a real type scale, layered panel depth, precise meters and knobs, lit states, refined motion. The button language is the owner's liked mock-up ${REPO}/docs/design-reference/31-owner-liked-top-buttons.jpg (see its section in ${REPO}/docs/design-reference/README.md). Pads stay pads: never waveforms or clip chips on pads. The Audius lockup stays white on dark backgrounds.
- Code: app/public/index.html (inline Lucide sprite; icons are <svg class="icon"><use href="#i-NAME"/></svg>), styles.css (~5000 lines; theme variable blocks at the top, then layered overrides, often !important), app.js (ES module; the playlist is a <canvas> drawn in JS). Grep app.js before renaming any id/class.
- Design skill: ${IMP}/SKILL.md and its reference/ files (craft-floor.md before any UI edit; critique, audit, layout, typeset, colorize, animate, polish, adapt, operate).
- Layout references: ${REPO}/docs/design-reference/README.md and its images (for layout/behaviour only; never other products' names, logos, skins or knob art in app/public).
- Hard constraints at every width from 320 to 3840: no horizontal page scroll or sideways-scrolling bars; nothing clipped, overlapping or off-screen; text at least 15px; touch controls at least 44x44px on (pointer: coarse), (hover: none); default view Library + Playlist only with Mixer and Trellis closed; close (x) on every panel; one-click delete; 3-column desktop layout; 1:1 track header/lane alignment; all features, shortcuts and themes (audius-dark, amoled, daylight, forest, ocean, amethyst, cyberpunk, platinum-slate, nordic) keep working; reduced motion keeps a gentle alternative; visible focus; no innerHTML with data; no emoji icons.
- Older browsers (owner's Galaxy Note 3 is about Chrome 95; older iPads Safari 14-15): no @layer, color-mix(), oklch/oklab, :has(), container queries, CSS nesting, @property or light-dark() without a complete fallback on the line before; vh fallback before dvh; no structuredClone/findLast in JS.
- Harness: ${HARNESS} (open, openWindow, shot, probe, report; viewports 1920x1080, 1440x900, 1366x768, 1024x1366t, 1366x1024t, 360x640t, 640x360t, t = touch). It reads STUDIO_URL. Run node with NODE_PATH=/opt/node22/lib/node_modules. Chromium only. Original screenshots: ${SP}/design/shots/before/<viewport>-app.png and <viewport>-<step|piano|mixer|inspector|trellis>.png.
- Never commit, push or switch branches. Never edit the main checkout ${REPO} unless your role says so (no role here does).
`
const AREA = `
AREA: ${A.title}
Scope: ${A.scope}
Focus: ${A.focus}
Windows to open (harness openWindow names): ${(A.windows || []).join(', ') || 'none (main view)'}
`
const ROLE = {
  scanner: `ROLE: read-only scanner (Haiku). Do not create, edit or delete any file in the repository. Write scripts/screenshots only under ${WORK}/scan/. Report candidates you actually observed, each with evidence; no verdicts, no narration.`,
  confirmer: `ROLE: verifier. You check ONE candidate issue against the unchanged app at ${BASE_URL} (set STUDIO_URL to it). Do not edit any file in the repository; scripts go under ${WORK}/confirm/. Try to disprove it. confirmed=true only if you reproduced it yourself, with evidence.`,
  patcher: port => `ROLE: patcher in your own git worktree (your current directory). Edit only files in this worktree, never ${REPO}. Serve this worktree's app/public in the background with: (cd app/public && nohup python3 -m http.server ${port} --bind 127.0.0.1 >/dev/null 2>&1 &) and test with STUDIO_URL=http://127.0.0.1:${port}/ . Kill that server when done. Read ${IMP}/reference/craft-floor.md before the first edit.`,
  verifier: port => `ROLE: verifier in your own git worktree (your current directory). Apply the patch, serve this worktree's app/public on port ${port} in the background ((cd app/public && nohup python3 -m http.server ${port} --bind 127.0.0.1 >/dev/null 2>&1 &)), test with STUDIO_URL=http://127.0.0.1:${port}/ , kill the server when done. Do not change any file except by applying the patch. Report only problems you reproduced, with evidence.`,
}

// ---- schemas (validated at the tool-call layer; malformed output is retried, never reaches this script) ----
const CANDIDATES = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          where: { type: 'string', description: 'file:line or selector' },
          evidence: { type: 'string' },
          proposal: { type: 'string' },
        },
        required: ['title', 'severity', 'where', 'evidence', 'proposal'],
      },
    },
  },
  required: ['candidates'],
}
const TRIAGE = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          route: { type: 'string', enum: ['in-scope', 'later-area', 'drop'] },
          area: { type: 'string', description: 'for later-area: one of toolbar, library, playlist, step-rack, piano-roll, mixer, effect-windows, trellis, menus-dialogs, phone-layout, themes' },
          group: { type: 'string', description: 'short canonical name of the underlying problem; give duplicates the same name' },
        },
        required: ['id', 'route', 'area', 'group'],
      },
    },
  },
  required: ['items'],
}
const CONFIRM = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
    evidence: { type: 'string' },
    fix_hint: { type: 'string' },
  },
  required: ['confirmed', 'severity', 'evidence', 'fix_hint'],
}
const SPEC = {
  type: 'object',
  properties: { spec: { type: 'string' }, acceptance: { type: 'array', items: { type: 'string' } } },
  required: ['spec', 'acceptance'],
}
const PATCH = {
  type: 'object',
  properties: {
    patch_path: { type: 'string' },
    summary: { type: 'string' },
    changed_files: { type: 'array', items: { type: 'string' } },
    self_check: { type: 'string' },
  },
  required: ['patch_path', 'summary', 'changed_files', 'self_check'],
}
const VERDICT = {
  type: 'object',
  properties: {
    patch_applied: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          where: { type: 'string' },
          evidence: { type: 'string' },
          fix_hint: { type: 'string' },
        },
        required: ['title', 'severity', 'where', 'evidence', 'fix_hint'],
      },
    },
  },
  required: ['patch_applied', 'issues'],
}
const SHOTS = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, caption: { type: 'string' } }, required: ['path', 'caption'] } },
    final_probe: { type: 'string' },
  },
  required: ['files', 'final_probe'],
}

// One separate verifier per issue (CLAUDE.md). base: null = unchanged app; otherwise a patch path.
async function confirmEach(issues, phaseName, patchPath) {
  const results = await parallel(issues.map((iss, i) => () => {
    const port = nextPort(PORTS.confirm)
    const prompt = patchPath
      ? `${COMMON}\n${AREA}\n${ROLE.verifier(port)}\nApply ${patchPath} with git apply. Then check this ONE reported issue and try to disprove it:\n${JSON.stringify(iss, null, 1)}\nconfirmed=true only if you reproduced it on the patched app.`
      : `${COMMON}\n${AREA}\n${ROLE.confirmer}\nCheck this ONE candidate issue:\n${JSON.stringify(iss, null, 1)}`
    return agent(prompt, {
      label: `confirm:${norm(iss.title).slice(0, 28)}`, phase: phaseName, model: 'sonnet', schema: CONFIRM,
      ...(patchPath ? { isolation: 'worktree' } : {}),
    }).then(v => v && v.confirmed ? { ...iss, severity: v.severity, evidence: v.evidence, fix_hint: v.fix_hint } : null)
  }))
  return results.filter(Boolean)
}

// ---------------------------------------------------------------------------
// 1. Scan: Haiku, one scanner per file slice and per viewport (read-only)
// ---------------------------------------------------------------------------
phase('Scan')
const codeScans = SLICES.map(s => () => agent(`${COMMON}\n${AREA}\n${ROLE.scanner}
Read ${REPO}/${s.file} lines ${s.from}-${s.to} only (if the file is shorter, read what exists; if nothing, return no candidates). Find code in that slice that keeps THIS AREA from looking and working like an expert-made, premium studio, or that breaks a hard constraint: inconsistent or hard-coded colours/sizes, text under 15px, touch targets under 44px, missing states (hover, pressed, selected, disabled, focus), override conflicts (!important fights), old-browser-incompatible CSS/JS, innerHTML with data, accessibility gaps. Quote the line numbers.`,
  { label: `scan:${s.file.split('/').pop()}:${s.from}`, phase: 'Scan', model: 'haiku', schema: CANDIDATES }))
const viewScans = VIEWPORTS.map(vp => () => agent(`${COMMON}\n${AREA}\n${ROLE.scanner}
Set STUDIO_URL=${BASE_URL}. At viewport ${vp} only: open the app with the harness, open this area's windows, take a full screenshot and close-up crops into ${WORK}/scan/${vp}/, run probe() unscoped and scoped to the area, and look at the screenshots. Report visual and responsive candidates for THIS AREA: clipping, overlap, sideways scroll, small text or targets, weak hierarchy, uneven spacing, muddy contrast, states that do not read, anything that looks cheap next to the owner's liked mock-up.`,
  { label: `scan:view:${vp}`, phase: 'Scan', model: 'haiku', schema: CANDIDATES }))
const scanned = (await parallel([...codeScans, ...viewScans])).filter(Boolean)
const rawCandidates = scanned.flatMap(r => r.candidates)
const candidates = dedupe(rawCandidates.filter(c => c.evidence && c.evidence.trim().length > 8))
log(`Scan: ${rawCandidates.length} raw candidates from ${scanned.length}/${codeScans.length + viewScans.length} scanners -> ${candidates.length} after evidence filter and dedupe`)

// ---------------------------------------------------------------------------
// 2. Confirm: one Sonnet verifier per candidate
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 2. Triage: Haiku sorts candidates in batches; plain JS merges groups and routes
// ---------------------------------------------------------------------------
phase('Triage')
const TRIAGE_BATCH = 40
const indexed = candidates.map((c, id) => ({ id, ...c }))
const batches = []
for (let i = 0; i < indexed.length; i += TRIAGE_BATCH) batches.push(indexed.slice(i, i + TRIAGE_BATCH))
const triaged = (await parallel(batches.map((b, k) => () => agent(`${COMMON}\n${AREA}
ROLE: triage (Haiku, read-only; do not open files unless a candidate is unclear). For each candidate below, route it: "in-scope" if fixing it belongs to THIS AREA as scoped above; "later-area" if it belongs to another area (name it in area); "drop" if it is vague, not a real problem, or already satisfied. Give every candidate a short canonical group name for its underlying problem, so duplicates (also across batches) share one name; prefer names like "button-radius-inconsistent", "text-under-15px:status-pill".
CANDIDATES:
${JSON.stringify(b.map(c => ({ id: c.id, title: c.title, severity: c.severity, where: c.where })), null, 0)}`,
  { label: `triage:${k + 1}`, phase: 'Triage', model: 'haiku', schema: TRIAGE })))).filter(Boolean).flatMap(r => r.items)
const routeOf = new Map(triaged.map(t => [t.id, t]))
const groups = new Map()
for (const c of indexed) {
  const t = routeOf.get(c.id) || { route: 'in-scope', area: '', group: issueKey(c) } // untriaged: keep, never lose silently
  const g = `${t.route}|${norm(t.group)}`
  const prev = groups.get(g)
  if (!prev || (SEVERITY_RANK[c.severity] || 0) > (SEVERITY_RANK[prev.severity] || 0)) groups.set(g, { ...c, route: t.route, area: t.area, group: t.group, members: (prev ? prev.members : 0) + 1 })
  else prev.members += 1
}
const grouped = [...groups.values()]
const inScope = grouped.filter(c => c.route === 'in-scope')
const toConfirm = inScope.filter(c => (SEVERITY_RANK[c.severity] || 0) >= 2)
const inScopeLow = inScope.filter(c => (SEVERITY_RANK[c.severity] || 0) < 2)
const deferred = grouped.filter(c => c.route === 'later-area')
const dropped = grouped.filter(c => c.route === 'drop')
log(`Triage: ${indexed.length} candidates -> ${grouped.length} groups: ${inScope.length} in scope (${toConfirm.length} high/medium to confirm, ${inScopeLow.length} low not confirmed), ${deferred.length} deferred to later areas, ${dropped.length} dropped`)

// ---------------------------------------------------------------------------
// 3. Confirm: one Sonnet verifier per in-scope high/medium group
// ---------------------------------------------------------------------------
phase('Confirm')
// Agent concurrency is min(16, CPUs - 2): on a 4-core container that is 2 at a time, so one
// verifier per scan candidate before the patch would take hours. With confirmBeforePatch=false the
// candidates go to the patcher as UNVERIFIED hints it must reproduce itself, and nothing from the
// scan is reported as fact. Issues found in the patched app still get one verifier each (below).
let confirmed = []
let hints = []
if (A.confirmBeforePatch === false) {
  hints = toConfirm
  log(`Confirm: skipped before the patch; ${hints.length} in-scope high/medium candidates go to the patcher as unverified hints`)
} else {
  confirmed = await confirmEach(toConfirm, 'Confirm', null)
  log(`Confirm: ${confirmed.length}/${toConfirm.length} in-scope issues reproduced (${serious(confirmed).length} blocker/major)`)
}

// ---------------------------------------------------------------------------
// 3. Spec: given file, or Sonnet drafts one from the confirmed issues
// ---------------------------------------------------------------------------
phase('Spec')
let specRef
if (A.specFile) {
  specRef = { file: A.specFile, acceptance: 'See the "Acceptance criteria" section at the end of the spec file.' }
  log(`Spec: using ${A.specFile}`)
} else {
  const spec = await agent(`${COMMON}\n${AREA}
ROLE: lead designer (read-only; do not edit repository files). Write ONE complete, buildable spec for this area from the confirmed issues below and the owner's direction: exact values (sizes, spacing, radii, shadows, gradients, colours as theme variables, type), every state, motion with a reduced-motion alternative, layout per breakpoint (desktop >=1280, 900-1279, tablet touch, 360x640 portrait, 640x360 landscape, 320px), which selectors and files change, what must not change. Decide; do not list options. Then give acceptance criteria a Playwright verifier can check. Also write the spec to ${WORK}/spec.md.
CONFIRMED ISSUES:
${JSON.stringify(confirmed, null, 1)}`, { label: 'spec', phase: 'Spec', model: 'sonnet', schema: SPEC })
  specRef = { file: `${WORK}/spec.md`, acceptance: spec.acceptance.map((a, i) => `${i + 1}. ${a}`).join('\n') }
}

// ---------------------------------------------------------------------------
// 4. Patch: Sonnet in its own worktree, returns a patch file
// ---------------------------------------------------------------------------
phase('Patch')
const patchPort = nextPort(PORTS.patch)
let current = await agent(`${COMMON}\n${AREA}\n${ROLE.patcher(patchPort)}
Implement the spec in ${specRef.file} completely and with craft. Also fix these confirmed issues where the spec does not already cover them:
${JSON.stringify(confirmed, null, 1)}
${hints.length ? `UNVERIFIED HINTS from the read-only scan (${hints.length}). They may be wrong or already covered by the spec. Reproduce each one yourself before acting; fix only what you reproduce and what is in this area's scope; list the ones you found not real or out of scope in self_check:\n${JSON.stringify(hints.map(h => ({ title: h.title, severity: h.severity, where: h.where, evidence: h.evidence, proposal: h.proposal })), null, 0)}` : ''}
Prefer editing the rules that already style an element over adding another !important layer; if you add a block, keep one clearly commented block for this area at the end of styles.css. Keep app.js changes minimal and safe; run node --check on changed JS. Test at all 7 viewports with the harness and look at your screenshots (${WORK}/patch/). Run grep -nE '@layer|color-mix|oklch|oklab|:has\\(|@container|@property|light-dark' app/public/styles.css and make sure every hit is gone or has a full fallback before it.
Finish by writing the patch: git add -A && git diff --cached HEAD > ${WORK}/patch-0.diff (mkdir -p ${WORK} first). Acceptance:
${specRef.acceptance}`, { label: 'patch', phase: 'Patch', model: 'sonnet', isolation: 'worktree', schema: PATCH })
if (!current) { log('Patch step returned nothing; stopping.'); return { area: A.key, error: 'patch step failed', confirmed } }

// ---------------------------------------------------------------------------
// 5/6. Verify -> per-issue confirm -> Fix, until clean or stalled
// ---------------------------------------------------------------------------
const CHECKS = [
  { key: 'regression', prompt: `Regression check: probe() unscoped and scoped at all 7 viewports plus 320x568t, 2560x1440 and 3840x2160, in audius-dark, daylight and cyberpunk, and with reduced motion; open step, piano, mixer, inspector and trellis at 1366x768 and 360x640t; check track-header/lane alignment within 1px at 1920x1080 and 360x640t. Compare against the original screenshots. Report new horizontal scroll, clipping, overlap, off-screen controls, text under 15px, touch targets under 44px, console errors, alignment breaks, and any old-browser-incompatible CSS/JS in the patch.` },
  { key: 'function', prompt: `Function check: use every control in this area like a user (click/tap, drag, shortcuts, menus, Escape) at 1366x768 and 360x640t, plus a smoke test: play, stop, PAT/SONG, tempo +/-, open/close each window by F5/F6/F7/F9 and its button, pick a tool, select and delete a clip. Read the patch for broken selectors app.js relies on, lost handlers, innerHTML with data, JS errors.` },
  { key: 'visual', prompt: `Visual check with a design director's eye (read ${IMP}/reference/polish.md): screenshots at 1920x1080, 1366x768, 1024x1366t, 360x640t, 640x360t plus crops, compared with the spec, the owner's liked mock-up and the originals. Report misalignment, uneven spacing, inconsistent radii/borders/shadows, weak hierarchy, low contrast, states that do not read, crowded text, mis-sized icons, anything cheap or generic; also the daylight and cyberpunk themes.` },
]
const rounds = []
let openIssues = []
let best = Infinity
let stalled = 0
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase('Verify')
  const verdicts = (await parallel(CHECKS.map(c => () => {
    const port = nextPort(PORTS.verify)
    return agent(`${COMMON}\n${AREA}\n${ROLE.verifier(port)}
Apply ${current.patch_path} with git apply (report patch_applied=false if it fails). ${c.prompt}
Patch summary: ${current.summary}
Spec: ${specRef.file}. Acceptance:
${specRef.acceptance}`, { label: `verify${round}:${c.key}`, phase: 'Verify', model: 'sonnet', isolation: 'worktree', schema: VERDICT })
      .then(v => v && { check: c.key, ...v })
  }))).filter(Boolean)
  if (verdicts.some(v => !v.patch_applied)) log(`Verify round ${round}: a verifier could not apply the patch`)
  const reported = dedupe(verdicts.flatMap(v => v.issues.map(i => ({ ...i, check: v.check }))))
  const minorHints = reported.filter(i => (SEVERITY_RANK[i.severity] || 0) < 2)
  const real = await confirmEach(serious(reported), 'Verify', current.patch_path)
  const score = serious(real).length
  rounds.push({ round, patch: current.patch_path, reported: reported.length, minor_unverified: minorHints.length, confirmed: real.length, serious: score })
  log(`Round ${round}: ${reported.length} reported (${minorHints.length} minor, not separately verified), ${real.length} blocker/major confirmed`)
  openIssues = real
  if (real.length === 0 && (minorHints.length === 0 || round > 1)) break
  // stop rule (CLAUDE.md): two consecutive rounds without fewer blocker/major issues
  if (score < best) { best = score; stalled = 0 } else { stalled++ }
  if (stalled >= STALL_LIMIT) { log(`Stopping: ${STALL_LIMIT} rounds without progress`); break }
  if (score === 0 && round > 1) break // only minor polish left after a fix round
  if (round === MAX_ROUNDS) break

  phase('Fix')
  const fixPort = nextPort(PORTS.fix)
  const fixed = await agent(`${COMMON}\n${AREA}\n${ROLE.patcher(fixPort)}
First apply the current patch: git apply ${current.patch_path}. Then fix every confirmed issue below (blocker and major first; minor ones when cheap and safe). Verify each fix with the harness (screenshots under ${WORK}/fix-${round}/), re-run probe() at all 7 viewports, run node --check on changed JS. Finish with the cumulative patch: git add -A && git diff --cached HEAD > ${WORK}/patch-${round}.diff
Spec for reference: ${specRef.file}
CONFIRMED ISSUES:
${JSON.stringify(real, null, 1)}
MINOR POLISH (reported by a check, not separately verified; reproduce before changing anything):
${JSON.stringify(minorHints, null, 1)}`, { label: `fix${round}`, phase: 'Fix', model: 'sonnet', isolation: 'worktree', schema: PATCH })
  if (!fixed) { log(`Fix round ${round} returned nothing; keeping the previous patch`); break }
  current = fixed
}

// ---------------------------------------------------------------------------
// 7. Screens: Haiku captures the deliverable set from the final patch
// ---------------------------------------------------------------------------
phase('Screens')
const shotPort = PORTS.screens
const shots = await agent(`${COMMON}\n${AREA}
ROLE: screenshot capture (Haiku) in your own git worktree. Apply ${current.patch_path} with git apply; change nothing else. Serve this worktree's app/public on port ${shotPort} in the background ((cd app/public && nohup python3 -m http.server ${shotPort} --bind 127.0.0.1 >/dev/null 2>&1 &)), use STUDIO_URL=http://127.0.0.1:${shotPort}/ , kill the server when done. mkdir -p ${OUT}.
For each of 1920x1080, 1366x768, 1024x1366t, 360x640t, 640x360t: the full app with this area visible as ${OUT}/after-<viewport>.png (desktop with open(browser, vp, {scale: 2})), and close-up crops of each part of the area as ${OUT}/crop-<part>-<viewport>.png. Also ${OUT}/theme-daylight-1366x768.png and ${OUT}/theme-cyberpunk-1366x768.png. For each viewport make ${OUT}/compare-<viewport>.png: the original ${SP}/design/shots/before/<viewport>-app.png beside your after shot, both scaled to the same height, joined with ffmpeg hstack, under 3000px wide. Look at every image; retake any that are blank or mid-animation. Run probe() unscoped at all 7 viewports and summarise in final_probe. Return every file with a one-line plain-English caption.`,
  { label: 'screens', phase: 'Screens', model: 'haiku', isolation: 'worktree', schema: SHOTS })

return {
  area: A.key,
  final_patch: current.patch_path,
  patch_summary: current.summary,
  changed_files: current.changed_files,
  scan: { scanners: scanned.length, raw: rawCandidates.length, deduped: candidates.length, groups: grouped.length, in_scope: inScope.length, confirmed: confirmed.length },
  in_scope_low_unconfirmed: inScopeLow.map(c => ({ title: c.title, where: c.where, group: c.group })),
  deferred_by_area: deferred.reduce((m, c) => { (m[c.area || 'unassigned'] = m[c.area || 'unassigned'] || []).push({ title: c.title, severity: c.severity, where: c.where, group: c.group }); return m }, {}),
  dropped: dropped.length,
  rounds,
  open_issues: openIssues,
  shots,
}

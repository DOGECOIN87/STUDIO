export const meta = {
  name: 'studio-fix-issues-sequential',
  description: 'Fix a list of Audius Studio issues one at a time: Sonnet patches each in its own worktree, a separate Sonnet verifier confirms it, then the next builds on it',
  whenToUse: 'A known list of confirmed issues to fix in order. The main session (Opus) reviews the final cumulative patch and screenshots before commit.',
  phases: [
    { title: 'Fix', detail: 'one Sonnet patcher per issue, in its own worktree, building on the previous patch', model: 'sonnet' },
    { title: 'Verify', detail: 'one Sonnet verifier per issue, in its own worktree', model: 'sonnet' },
    { title: 'Regression', detail: 'one Sonnet check of the final patch at every viewport', model: 'sonnet' },
    { title: 'Screens', detail: 'Haiku captures before/after for each issue', model: 'haiku' },
  ],
}

// args: { key, issues: [{ id, title, detail }] }
// Plain-JS routing: issue order, ports, cumulative patch chaining, retry and stop rules.
const A = args
const REPO = '/home/user/DAW'
const SP = '/tmp/claude-0/-home-user-DAW/717ea5f2-42d2-5656-8044-03574a727b85/scratchpad'
const IMP = '/home/user/dogecoin87/impeccable/plugin/skills/impeccable'
const HARNESS = `${REPO}/docs/design-pass/harness/lib.cjs`
const WORK = `${SP}/design/work/${A.key}`
const OUT = `${SP}/design/shots/${A.key}`
const BASE_URL = 'http://127.0.0.1:8767/' // main checkout as it is now (the "before")
const MAX_ATTEMPTS = 2 // CLAUDE.md: stop after two attempts without progress

let portSeq = 0
const port = () => 8901 + (portSeq++ % 60)

const COMMON = `
CONTEXT
- Audius Studio: a browser DAW, an unofficial community-built app for the Audius community. Read ${REPO}/CLAUDE.md, ${REPO}/PRODUCT.md and ${REPO}/DESIGN.md (the design system now live; follow its tokens and primitives, never hard-code colours).
- Code: app/public/index.html, styles.css (theme blocks, legacy geometry, then the design-system block at the end), app.js (ES module). Grep app.js before renaming any id/class.
- Hard constraints at every width 320-3840: no sideways scroll, nothing clipped/overlapping/off-screen, text >= 15px, touch controls >= 44x44 on (pointer: coarse), (hover: none), all themes (audius-dark, amoled, daylight, forest, ocean, amethyst, cyberpunk, platinum-slate, nordic) work, reduced motion keeps a gentle alternative, visible focus, no innerHTML with data, pads stay pads (no waveforms).
- Older browsers (Galaxy Note 3 ~ Chrome 95, Safari 14-15): no @layer, color-mix(), oklch, :has(), container queries, CSS nesting, @property, light-dark() without a complete fallback before it; vh before dvh; no structuredClone/findLast.
- Harness: ${HARNESS} (open, openWindow, shot, probe, report; viewports 1920x1080, 1440x900, 1366x768, 1024x1366t, 1366x1024t, 360x640t, 640x360t). It reads STUDIO_URL. NODE_PATH=/opt/node22/lib/node_modules. Chromium only. The unchanged current app is at ${BASE_URL}.
- Never commit, push or switch branches. Never edit ${REPO} itself; you work in your own git worktree (your current directory).
`
const serve = p => `Serve this worktree's app/public in the background: (cd app/public && nohup python3 -m http.server ${p} --bind 127.0.0.1 >/dev/null 2>&1 &) and use STUDIO_URL=http://127.0.0.1:${p}/ . Kill that server when you finish.`

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
    fixed: { type: 'boolean' },
    regressions: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
    feedback: { type: 'string', description: 'if not fixed or regressed: exactly what is still wrong and where' },
  },
  required: ['patch_applied', 'fixed', 'regressions', 'evidence', 'feedback'],
}
const FINAL = {
  type: 'object',
  properties: {
    patch_applied: { type: 'boolean' },
    clean: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    probe_summary: { type: 'string' },
  },
  required: ['patch_applied', 'clean', 'problems', 'probe_summary'],
}
const SHOTS = {
  type: 'object',
  properties: {
    files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, caption: { type: 'string' } }, required: ['path', 'caption'] } },
  },
  required: ['files'],
}

let current = null // cumulative patch path; null = nothing yet
const results = []

for (let n = 0; n < A.issues.length; n++) {
  const iss = A.issues[n]
  let feedback = ''
  let accepted = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !accepted; attempt++) {
    phase('Fix')
    const p1 = port()
    const out = `${WORK}/patch-${iss.id}-a${attempt}.diff`
    const fix = await agent(`${COMMON}
ROLE: patcher (Sonnet) in your own git worktree. ${current ? `First apply the previous fixes: git apply ${current}` : 'Start from the worktree as it is.'}
Then fix ONLY this issue, completely and with craft, using the design system's tokens and primitives. Read ${IMP}/reference/craft-floor.md first.
ISSUE ${iss.id}: ${iss.title}
${iss.detail}
${feedback ? `A verifier rejected the previous attempt. Its feedback:\n${feedback}\n` : ''}
${serve(p1)} Reproduce the issue first, then fix it, then prove the fix at every viewport it affects, and run probe() at all 7 viewports to make sure nothing else broke. Run node --check on changed JS. Finish with the cumulative patch (previous fixes plus yours): mkdir -p ${WORK} && git add -A && git diff --cached HEAD > ${out}`,
      { label: `fix:${iss.id}${attempt > 1 ? ':retry' : ''}`, phase: 'Fix', model: 'sonnet', isolation: 'worktree', schema: PATCH })
    if (!fix) { feedback = 'The patcher returned nothing.'; continue }

    phase('Verify')
    const p2 = port()
    const v = await agent(`${COMMON}
ROLE: verifier (Sonnet) in your own git worktree. Apply ${fix.patch_path} with git apply (patch_applied=false if it fails); change nothing else. ${serve(p2)}
Check this ONE issue independently. Reproduce it first on the unchanged app at ${BASE_URL}, then check the patched app. Try to show it is NOT fixed. fixed=true only if it is fully fixed at every viewport and theme it affects.
ISSUE ${iss.id}: ${iss.title}
${iss.detail}
Then run probe() unscoped at all 7 viewports on the patched app and compare with the unchanged app: list any NEW problem in regressions (with viewport and selector).
Patcher's summary: ${fix.summary}`,
      { label: `verify:${iss.id}${attempt > 1 ? ':retry' : ''}`, phase: 'Verify', model: 'sonnet', isolation: 'worktree', schema: VERDICT })
    if (v && v.patch_applied && v.fixed && v.regressions.length === 0) {
      accepted = { fix, verdict: v }
    } else {
      feedback = v ? `${v.feedback}\nRegressions: ${v.regressions.join('; ') || 'none'}\nEvidence: ${v.evidence}` : 'The verifier returned nothing.'
      log(`Issue ${iss.id} attempt ${attempt} rejected`)
    }
  }
  if (accepted) {
    current = accepted.fix.patch_path
    results.push({ id: iss.id, title: iss.title, status: 'fixed', summary: accepted.fix.summary, evidence: accepted.verdict.evidence, patch: current })
    log(`Issue ${iss.id} fixed and verified`)
  } else {
    results.push({ id: iss.id, title: iss.title, status: 'not fixed after 2 attempts', feedback })
    log(`Issue ${iss.id}: stopping after ${MAX_ATTEMPTS} attempts without a verified fix; keeping the previous patch`)
  }
}

if (!current) return { key: A.key, results, final_patch: null }

phase('Regression')
const p3 = port()
const final = await agent(`${COMMON}
ROLE: regression verifier (Sonnet) in your own git worktree. Apply ${current} with git apply; change nothing else. ${serve(p3)}
Run probe() unscoped at all 7 viewports plus 320x568t, in audius-dark, daylight and cyberpunk, and with reduced motion; open step, piano, mixer, inspector and trellis at 1366x768 and 360x640t; play/stop, switch tools, open and close every menu and dialog (Export, Open Project, Shortcuts), right-click a clip. Compare with the unchanged app at ${BASE_URL}. clean=true only if nothing got worse.`,
  { label: 'regression', phase: 'Regression', model: 'sonnet', isolation: 'worktree', schema: FINAL })

phase('Screens')
const p4 = port()
const shots = await agent(`${COMMON}
ROLE: screenshot capture (Haiku) in your own git worktree. Apply ${current} with git apply; change nothing else. ${serve(p4)} mkdir -p ${OUT}.
For each fixed issue below, capture the same view twice at the viewport where the issue shows: BEFORE from ${BASE_URL} and AFTER from your server (use open(browser, vp, {scale: 2})), save ${OUT}/issue-<id>-before.png and ${OUT}/issue-<id>-after.png, then join them side by side with ffmpeg (scale both to the same height, hstack, under 2400px wide) as ${OUT}/issue-<id>-compare.png. Look at every image and retake any that do not show the issue area. Return each compare image with a one-line plain-English caption.
FIXED ISSUES:
${JSON.stringify(results.filter(r => r.status === 'fixed').map(r => ({ id: r.id, title: r.title, detail: (A.issues.find(i => i.id === r.id) || {}).detail })), null, 1)}`,
  { label: 'screens', phase: 'Screens', model: 'haiku', isolation: 'worktree', schema: SHOTS })

return { key: A.key, final_patch: current, results, regression: final, shots }

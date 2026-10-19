export const meta = {
  name: 'studio-aspect-design',
  description: 'Design, build, verify and screenshot one Audius Studio UI area (one area per run)',
  whenToUse: 'One UI area of Audius Studio at a time: study it from three angles, write one build spec, implement it, verify adversarially, fix, and capture screenshots.',
  phases: [
    { title: 'Study', detail: 'visual, UX and responsive critics read the area (read-only)' },
    { title: 'Spec', detail: 'one build spec from all findings' },
    { title: 'Build', detail: 'one implementer edits the files' },
    { title: 'Verify', detail: 'regression, function and visual verifiers' },
    { title: 'Fix', detail: 'one fixer per round, at most two rounds' },
    { title: 'Screens', detail: 'final before/after screenshot set' },
  ],
}

const A = args
const SP = '/tmp/claude-0/-home-user-DAW/717ea5f2-42d2-5656-8044-03574a727b85/scratchpad'
const IMP = '/home/user/dogecoin87/impeccable/plugin/skills/impeccable'
const WORK = `${SP}/design/work/${A.key}`
const OUT = `${SP}/design/shots/${A.key}`

const COMMON = `
CONTEXT (read carefully; it applies to every step):
- Product: Audius Studio, a browser DAW, an unofficial community-built app for the Audius community (never imply it is official). Read /home/user/DAW/PRODUCT.md first. If /home/user/DAW/DESIGN.md exists, it is the design system: follow it and extend it rather than inventing parallel styles.
- Owner's chosen direction: "Elevate the Audius look": keep the Audius dark-purple brand and the Avenir Next type, then add pro-studio craft: a real type scale, layered panel depth, precise meters and knobs, lit states, refined motion. The result must look advanced, visually appealing and expert-made, as good as the best desktop DAWs, while every control stays standard and obvious (impeccable Operate mode: the working product comes first).
- Code: /home/user/DAW/app/public: index.html (inline Lucide SVG sprite; icons are <svg class="icon"><use href="#i-NAME"/></svg>), styles.css (~5000 lines; themes are body[data-theme=...] variable blocks at the top, then many later override layers, often with !important), app.js (ES module ~5000 lines; the playlist is drawn on a <canvas>, so its colours live in app.js), audio-engine.js, wav-codec.js. Before renaming or removing any id/class, grep app.js for it.
- The app is served at http://127.0.0.1:8767/ by an already-running static server. Never start or stop servers. Edits show up on reload.
- Design skill (the owner's own "impeccable" repo): ${IMP}/SKILL.md. Read reference/craft-floor.md before any UI edit, and the references that fit your job (critique.md, audit.md, layout.md, typeset.md, colorize.md, animate.md, polish.md, adapt.md, operate.md, mode-operate.md, document.md). Mechanical detector: ${IMP}/scripts/impeccable detect --json <files>.
- Layout references: /home/user/DAW/docs/design-reference/README.md and the images in that folder (FL Studio screenshots). Use them for layout and behaviour ONLY. Never put "FL Studio", "Fruity", "Image-Line", their logos, skins, icons or knob graphics into app/public.
- Hard constraints, at every size from 320px wide to 3840px:
  * No horizontal page scroll and no sideways-scrolling strips in any bar; nothing clipped, overlapping or off-screen. (The playlist canvas and piano-roll grid scroll by design.)
  * Readable text at least 15px. On touch devices ((pointer: coarse), (hover: none)) every control is at least 44x44px; desktop may be compact.
  * Default first view: Library + Playlist only, with Mixer and Trellis closed. Every panel keeps its close (x) button; delete actions stay one click.
  * Keep the 3-column desktop layout, exact 1:1 alignment of track headers with playlist lanes, the five windows plus the Trellis dock, all features and keyboard shortcuts.
  * All themes must keep working: audius-dark (default), amoled, daylight (light), forest, ocean, amethyst, cyberpunk, platinum-slate, nordic, plus wallpapers. Use theme variables, not hard-coded colours, for anything theme-dependent.
  * Respect prefers-reduced-motion with a gentle alternative (opacity/colour) instead of removing feedback; keep visible :focus-visible rings.
  * Never put project or user data through innerHTML (use textContent). No emoji as icons; new icons are Lucide: copy paths from ${SP}/lucide-dl/package/icons/NAME.svg into a new <symbol id="i-NAME" viewBox="0 0 24 24"> in the sprite.
  * Breakpoints already in use: compact layout = (max-width: 760px), (max-width: 900px) and (max-height: 520px); its inverse = (min-width: 901px), (min-width: 761px) and (min-height: 521px).
- Test harness: ${SP}/design/lib.cjs (read its header and exports: open(), openWindow(), shot(), probe(), report(), VPS, CORE). Viewports: 1920x1080, 1440x900, 1366x768, 1024x1366t, 1366x1024t, 360x640t, 640x360t (t = touch). Run scripts with NODE_PATH=/opt/node22/lib/node_modules node <script>.cjs. Chromium only. Put your scripts and screenshots under ${WORK}/ (mkdir -p it). The original look before this design pass is in ${SP}/design/shots/before/ (<viewport>-app.png and <viewport>-<step|piano|mixer|inspector|trellis>.png).
- Look at screenshots with the Read tool (it shows images). Judge them with a design director's eye.
- Git: do NOT commit, push or switch branches, and do not change the ?v= cache numbers in index.html. The lead handles that.
`

const AREA = `
THIS RUN'S AREA: ${A.title}
Scope: ${A.scope}
Focus: ${A.focus}
Windows to open for this area (harness openWindow names): ${(A.windows || []).join(', ') || 'none (main view)'}
Stay inside this area. Shared primitives may change only through tokens/DESIGN.md, and other areas must not regress.
`


const COMPAT = `
BROWSER COMPATIBILITY OVERRIDE (from the lead; this beats anything in the spec):
The owner tests on a Samsung Galaxy Note 3, whose newest stock browser is about Chrome 95, and the audience includes older iPads (Safari 14-15). The CSS must work in Chrome 90+, Safari 14+ and Firefox 90+:
- Do NOT use @layer anywhere. Browsers without it drop the whole block, which would leave the app unstyled. Get precedence the old way: put this pass's system block at the END of styles.css (after every legacy layer), raise specificity where needed (for example a body/.app-shell prefix), use !important only where it must beat an existing !important rule, and delete legacy rules that the system block fully replaces when that is safe. Where the spec says "put X in @layer legacy" or "@layer system", apply the same intent without layers.
- Do NOT rely on color-mix(), oklch()/oklab(), relative colour syntax, :has(), container queries, CSS nesting, @property, light-dark() or text-wrap. Compute colours as literal hex/rgb()/rgba() values per theme block instead (you may compute them with a script). If you keep a modern feature for extra polish, put a complete fallback declaration on the line before it, so older browsers still look right.
- dvh/svh units need a vh fallback declaration before them. :is()/:where(), gap on flex, aspect-ratio, inset and accent-color are fine.
- Keep JS to what Chrome 90 supports (no structuredClone, no Array.prototype.findLast).
- Before finishing, run: grep -nE '@layer|color-mix|oklch|oklab|:has\\(|@container|@property|light-dark' app/public/styles.css and make sure every hit is either gone or preceded by a complete fallback.
`

const STUDY = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          where: { type: 'string' },
          evidence: { type: 'string' },
          proposal: { type: 'string' },
        },
        required: ['title', 'severity', 'where', 'evidence', 'proposal'],
      },
    },
  },
  required: ['summary', 'findings'],
}

const SPEC = {
  type: 'object',
  properties: {
    spec: { type: 'string', description: 'Complete markdown build spec: concrete tokens/values, selectors, files, per-breakpoint behaviour, states, motion.' },
    acceptance: { type: 'array', items: { type: 'string' }, description: 'Checkable acceptance criteria' },
  },
  required: ['spec', 'acceptance'],
}

const BUILD = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    changed_files: { type: 'array', items: { type: 'string' } },
    probe_summary: { type: 'string' },
    screenshots: { type: 'array', items: { type: 'string' } },
    open_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'changed_files', 'probe_summary', 'screenshots', 'open_issues'],
}

const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          description: { type: 'string' },
          evidence: { type: 'string' },
          fix_hint: { type: 'string' },
        },
        required: ['severity', 'description', 'evidence', 'fix_hint'],
      },
    },
  },
  required: ['pass', 'issues'],
}

const SHOTS = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, caption: { type: 'string' } },
        required: ['path', 'caption'],
      },
    },
    final_probe: { type: 'string' },
  },
  required: ['files', 'final_probe'],
}

// ---------- Study ----------
phase('Study')
const LENSES = [
  {
    key: 'visual',
    prompt: `You are a design director doing an impeccable "critique" of this area's VISUAL design. Read ${IMP}/reference/critique.md, craft-floor.md, mode-operate.md, typeset.md, colorize.md and layout.md. Capture current screenshots of the area at 1920x1080, 1366x768, 1024x1366t and 360x640t (open the area's windows), and close-up crops. Compare with the FL reference images for structure. Find everything that keeps it from looking advanced, premium and expert-made in the Audius brand: hierarchy, type scale, spacing rhythm and alignment, surface depth and elevation, borders, colour roles and contrast, state styling (hover, pressed, selected, on/lit, disabled), iconography, density, consistency with the rest of the app, and any AI-slop tells. For each finding give the exact selector/element and a concrete proposal with values (sizes, colours as theme variables, shadows, radii, motion).`,
  },
  {
    key: 'ux',
    prompt: `You are a senior DAW UX designer. Study this area's INTERACTION design: read the relevant HTML, CSS and JS (event handlers in app.js), use the area in Playwright (click/tap/drag the real controls, keyboard shortcuts) at desktop and phone sizes. Compare with how pro DAWs (and the FL references, for layout and behaviour only) handle this area. Find friction: unclear affordances, missing or weak states and feedback, poor information order, controls that are hard to hit or easy to mis-hit, missing hover/long-press details, missing live value read-outs, empty/error states, discoverability of shortcuts. Read ${IMP}/reference/operate.md and clarify.md. Give concrete, buildable proposals that keep every existing feature and shortcut.`,
  },
  {
    key: 'responsive',
    prompt: `You are a front-end QA engineer auditing this area for RESPONSIVE, accessibility and edge-case defects. Read ${IMP}/reference/audit.md and adapt.md. With the harness, run probe() scoped to the area (and unscoped) at all 7 viewports, plus: widths 320, 480, 760, 900, 1024, 1280, 2560x1440, 3840x2160; reduced motion; the daylight and cyberpunk themes; long names (60+ characters, emoji, CJK) where the area shows names. Check contrast of text and icons (WCAG AA), focus visibility, keyboard reachability, aria-labels on icon-only buttons. Report each defect with the viewport, selector, measured numbers, and a concrete fix.`,
  },
]
const studies = (await parallel(LENSES.filter(l => !(A.skipLenses || []).includes(l.key)).map(l => () =>
  agent(`${COMMON}\n${AREA}\nYOUR JOB (read-only: do not edit any project file): ${l.prompt}\nReturn your findings, most important first.`,
    { label: `study:${l.key}`, phase: 'Study', schema: STUDY })
    .then(r => r && { lens: l.key, ...r })
))).filter(Boolean)
log(`Study: ${studies.map(s => `${s.lens} ${s.findings.length}`).join(', ')} findings`)

// ---------- Spec ----------
phase('Spec')
const spec = await agent(`${COMMON}\n${AREA}
YOUR JOB (read-only: do not edit project files): you are the lead designer. Three critics studied this area; their findings are below as JSON. Write ONE complete, buildable spec for this area that makes it look and work like an expert-made, premium studio in the Audius brand, per the owner's direction. Decide; don't list options. Include:
- the visual system for the area (exact values: sizes, spacing, radii, shadows, gradients, colour roles as theme variables, type sizes/weights, icon sizes), every state (rest, hover, pressed, selected/lit, disabled, focus), and motion (durations/easings, reduced-motion alternative);
- layout per breakpoint: desktop >=1280, small desktop 900-1279, tablet touch, compact phone portrait 360x640, phone landscape 640x360, plus 320px;
- interaction fixes from the UX critic and every defect from the responsive audit;
- exactly which selectors/files to change, and which app.js code (if any), noting ids/classes app.js depends on;
- what must NOT change.
${A.specNotes ? 'Extra instructions for this area: ' + A.specNotes : ''}
Read the code and screenshots you need to make the spec exact. Then give acceptance criteria that a verifier can check with Playwright.

FINDINGS JSON:
${JSON.stringify(studies, null, 1)}`, { label: 'spec', phase: 'Spec', schema: SPEC })

// ---------- Build ----------
phase('Build')
const build = await agent(`${COMMON}\n${AREA}
${COMPAT}
YOUR JOB: you are the implementer, the only agent editing files right now. Implement the spec below completely and with craft, in /home/user/DAW/app/public (and /home/user/DAW/DESIGN.md if the spec says so). Read ${IMP}/reference/craft-floor.md first.
Rules: prefer editing the rules that already style an element over piling on another !important override layer; when you must add a layer, put it in one clearly commented block for this area at the end of styles.css. Keep app.js changes minimal and safe. After building: reload and check the area at all 7 viewports with the harness (probe + screenshots into ${WORK}/build/), look at the screenshots yourself, fix what you see, run node --check on any JS you changed, and run the impeccable detector on the changed files. Report honestly what is still open.

SPEC:
${spec.spec}

ACCEPTANCE CRITERIA:
${spec.acceptance.map((a, i) => `${i + 1}. ${a}`).join('\n')}`, { label: 'build', phase: 'Build', schema: BUILD })

// ---------- Verify + Fix (bounded: at most two fix rounds) ----------
const VERIFIERS = [
  {
    key: 'regression',
    prompt: `Regression verifier. With the harness, run probe() unscoped and scoped to the area at all 7 viewports plus 320x568t, 2560x1440 and 3840x2160, in the default theme, daylight and cyberpunk, and with reduced motion. Compare against the original screenshots in ${SP}/design/shots/before/. Also open each of step, piano, mixer, inspector, trellis at 1366x768 and 360x640t and confirm nothing outside this area broke. Check track-header/lane alignment in the playlist (header row tops vs lane tops, within 1px) at 1920x1080 and 360x640t. Report every new horizontal scroll, clipped/overlapping/off-screen element, text under 15px, touch target under 44px on touch viewports, console error, or alignment break.`,
  },
  {
    key: 'function',
    prompt: `Functional verifier. Exercise every control in this area like a user (click/tap, drag, keyboard shortcuts, menus open/close, Escape) at 1366x768 and 360x640t, plus a global smoke test: play, stop, PAT/SONG, tempo +/-, open/close each window (F5/F6/F7/F9 and the toggle buttons), select a tool, select and delete a clip. Watch the console. Read the changed code (git diff in /home/user/DAW) for bugs: broken selectors that app.js queries, missing ids, event handlers lost, innerHTML with data, JS errors. Report every defect.`,
  },
  {
    key: 'visual',
    prompt: `Visual verifier with a design director's eye. Read ${IMP}/reference/polish.md and craft-floor.md. Take screenshots of the area at 1920x1080, 1366x768, 1024x1366t, 360x640t and 640x360t, plus close-up crops, and compare with the spec and with the original in ${SP}/design/shots/before/. Find anything that does not look expert-made and premium: misalignment, uneven spacing, inconsistent radii/borders/shadows, weak hierarchy, muddy or low-contrast colours, states that don't read, jarring motion, text crowding, icons mis-sized, anything that looks cheap or generic. Also check daylight and cyberpunk themes. Be strict: pass only if it is genuinely excellent.`,
  },
]

let rounds = []
let openIssues = []
const MAX_ROUNDS = A.verifyRounds || 2
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase('Verify')
  const verdicts = (await parallel(VERIFIERS.map(v => () =>
    agent(`${COMMON}\n${AREA}
${COMPAT}
YOUR JOB (read-only: do not edit project files; write scripts only under ${WORK}/verify-${round}-${v.key}/): ${v.prompt}
Be adversarial: try to find real problems, but report only problems you actually observed or traced, with evidence (viewport, selector, numbers, screenshot path). Severity: blocker = broken feature, console error, horizontal scroll, clipped/overlapping controls, constraint violated; major = clearly visible design or usability flaw; minor = polish.
The build summary for this area: ${build ? build.summary : '(build agent returned nothing)'}
Spec acceptance criteria:
${spec.acceptance.map((a, i) => `${i + 1}. ${a}`).join('\n')}`, { label: `verify${round}:${v.key}`, phase: 'Verify', schema: VERDICT })
      .then(r => r && { verifier: v.key, ...r })
  ))).filter(Boolean)
  const issues = verdicts.flatMap(v => v.issues.map(i => ({ ...i, verifier: v.verifier })))
  const serious = issues.filter(i => i.severity !== 'minor')
  rounds.push({ round, verdicts: verdicts.map(v => ({ verifier: v.verifier, pass: v.pass, issues: v.issues.length })) })
  log(`Verify round ${round}: ${serious.length} blocker/major, ${issues.length - serious.length} minor`)
  openIssues = issues
  if (serious.length === 0 && issues.length === 0) break
  if (round === MAX_ROUNDS && serious.length === 0) break

  phase('Fix')
  const fix = await agent(`${COMMON}\n${AREA}
${COMPAT}
YOUR JOB: you are the fixer, the only agent editing files right now. Verifiers found the issues below after the build. Fix every blocker and major issue, and every minor one that is cheap and safe. Verify each fix with the harness (scripts and screenshots under ${WORK}/fix-${round}/), re-run probe() at all 7 viewports, run node --check on changed JS, and look at the screenshots. If an issue is not real, say why in open_issues instead of changing code.

SPEC (for reference):
${spec.spec}

ISSUES JSON:
${JSON.stringify(issues, null, 1)}`, { label: `fix${round}`, phase: 'Fix', schema: BUILD })
  rounds[rounds.length - 1].fix = fix ? { summary: fix.summary, open: fix.open_issues } : null
  if (round === MAX_ROUNDS) openIssues = fix ? fix.open_issues.map(d => ({ severity: 'unverified', description: d })) : issues
}

// ---------- Screens ----------
phase('Screens')
const shots = await agent(`${COMMON}\n${AREA}
YOUR JOB (do not edit project files): capture the final screenshot set for the owner, who wants to see every aspect of this area visually. mkdir -p ${OUT}. Use the harness with deviceScaleFactor 2 on desktop too where it helps sharpness (open(browser, vp, {scale: 2})).
Capture, for each of 1920x1080, 1366x768, 1024x1366t, 360x640t and 640x360t: the full app with this area visible (open its windows) as ${OUT}/after-<viewport>.png, and close-up crops of each distinct part of the area (and its notable states: hover/selected/active/open menus, playing state if relevant) as ${OUT}/crop-<part>-<viewport>.png. Also capture this area in the daylight and cyberpunk themes at 1366x768 as ${OUT}/theme-<theme>-1366x768.png. For each viewport also make a side-by-side before/after image ${OUT}/compare-<viewport>.png from the original ${SP}/design/shots/before/<viewport>-${(A.windows && A.windows[0]) || 'app'}.png (fall back to <viewport>-app.png) and your after shot, using ffmpeg (hstack after scaling both to the same height, a few px gap; keep it under 3000px wide). Look at every image you produce and retake any that are blank, mid-animation, or don't show the area. Finally run probe() unscoped at all 7 viewports and summarise it in final_probe. Return every file with a one-line plain-English caption.`, { label: 'screens', phase: 'Screens', schema: SHOTS })

return {
  area: A.key,
  spec_acceptance: spec.acceptance,
  build: build && { summary: build.summary, changed_files: build.changed_files, open_issues: build.open_issues },
  rounds,
  open_issues: openIssues,
  shots,
}

import re, sys
src = open('/home/user/DAW/app/public/styles.css').read().split('\n')
# theme blocks are lines 1..236 (index 0..235); legacy starts at line 238 ("* {")
themes = '\n'.join(src[:243])
legacy_lines = src[243:]
def drop_ranges(lines, ranges, offset=244):
    out=[]
    for i,l in enumerate(lines):
        n=i+offset
        if any(a<=n<=b for a,b in ranges): continue
        out.append(l)
    return out
# brand !important block 2659-2702 (keep 2608..2658 logo rules), glass 2766-2781, RM blanket 3702-3712, RM 4532-4555, accent-mini 1758-1763
legacy_lines = drop_ranges(legacy_lines, [(2658,2703),(2753,2782),(3702,3711),(4532,4555),(1759,1763)])
legacy = '\n'.join(legacy_lines)
# remove typographic / visual !important declarations
legacy = re.sub(r'^\s*(font-size|font-weight|letter-spacing)\s*:[^;]*!important;\s*$', '', legacy, flags=re.M)
legacy = re.sub(r'^\s*border-color:\s*#fff !important;\s*$', '', legacy, flags=re.M)
# geometry tokens (prototype approximation of Part B)
geo = '''
/* prototype geometry tokens */
.toolbar-primary-menu { flex: 1 1 auto; }
@media (max-width: 1200px) { .toolbar-primary-content > .tool-cluster { flex-wrap: wrap; flex-shrink: 1; min-width: 0; } }
.tool-btn, .mini-btn, .toolbar-select { height: var(--ctl-h) !important; }
.action-btn, .theme-select { height: var(--ctl-h) !important; }
.transport-btn { width: var(--ctl-h); height: var(--ctl-h); }
.transport-btn.play { width: var(--ctl-h-lg); height: var(--ctl-h-lg); }
.tiny-btn { height: var(--ctl-h-sm) !important; }
.panel-close-btn { width: var(--ctl-h-sm); height: var(--ctl-h-sm); }
.bpm-step-btn { width: var(--ctl-h-sm); height: var(--ctl-h-sm); }
.trk-btn { width: var(--ctl-h-xs) !important; height: var(--ctl-h-xs) !important; }
.nudge-btn { height: var(--ctl-h); }
.ctx-btn { height: var(--ctl-h); }
.reopen-pool-btn { height: var(--ctl-h-sm); }
.asset-actions button { min-height: var(--ctl-h-sm); }
.topbar-menu > summary, .toolbar-primary-menu > summary, .toolbar-overflow-menu > summary, .transport-extras > summary, .transport-readouts > summary { min-height: var(--ctl-h); }
.panel-header, .fl-window-header, .track-column-top { padding-top: 4px; padding-bottom: 4px; }
@media (max-width: 760px), (max-width: 900px) and (max-height: 520px) {
  .topbar-menu > summary, .toolbar-primary-menu > summary, .toolbar-overflow-menu > summary { min-height: 44px; }
  .transport-btn, .transport-btn.play { width: 40px; min-width: 40px; height: 40px; }
}
'''
out = '@layer legacy, system;\n' + themes + '\n' + open('tokens-extra.css').read() + '\n' + open('roles.css').read() + '\n' + open('system-final.css').read() + '\n@layer legacy {\n' + legacy + '\n' + geo + '\n}\n'
open('styles.proto.css','w').write(out)
print(len(out.split('\n')), 'lines;', out.count('!important'), 'important')

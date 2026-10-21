;; Audius Studio — Gain Trim, the worked example for writing your own WASM effect.
;; Built to tools/wasm-plugins/examples/gain-trim.wasm by tools/wasm-plugins/build.mjs.
;;
;; This is the smallest useful plugin: a smoothed gain with a dry/wet-free,
;; click-free response. Copy it, change the DSP, and load the pair
;; (gain-trim.js + gain-trim.wasm) through the mixer's "Load effect files…".
;;
;; ABI (see tools/wasm-plugins/README.md): memory, init(sampleRate),
;; set_param(index, 0..1), process(inL, inR, outL, outR, frames).
;; Scratch buffers live at 0..4095; the smoothing state starts at 4096.
;;
;; Parameters: 0 gain (0 … 2x), 1 smoothing (0 … 1).
(module
  (memory (export "memory") 1)
  (global $gain (mut f32) (f32.const 1))
  (global $smooth (mut f32) (f32.const 0.2))
  (global $cur (mut f32) (f32.const 1))
  (global $CUR_PTR i32 (i32.const 4096))

  (func (export "init") (param $sampleRate f32)
    (global.set $cur (f32.const 1))
    (f32.store (global.get $CUR_PTR) (f32.const 1))
  )

  (func (export "set_param") (param $index i32) (param $value f32)
    (local $v f32)
    (local.set $v (f32.max (f32.const 0) (f32.min (f32.const 1) (local.get $value))))
    (if (i32.eq (local.get $index) (i32.const 0))
      (then (global.set $gain (f32.mul (local.get $v) (f32.const 2)))))
    (if (i32.eq (local.get $index) (i32.const 1))
      (then (global.set $smooth (f32.add (f32.const 0.002) (f32.mul (f32.const 0.12) (local.get $v))))))
  )

  (func (export "process") (param $inL i32) (param $inR i32) (param $outL i32) (param $outR i32) (param $frames i32)
    (local $i i32) (local $target f32) (local $cur f32) (local $a f32)
    (local.set $target (global.get $gain))
    (local.set $cur (f32.load (global.get $CUR_PTR)))
    (local.set $a (global.get $smooth))
    (local.set $i (i32.const 0))
    (block $done
      (loop $frame
        (br_if $done (i32.ge_u (local.get $i) (local.get $frames)))
        (local.set $cur (f32.add (local.get $cur) (f32.mul (local.get $a) (f32.sub (local.get $target) (local.get $cur)))))
        (f32.store (i32.add (local.get $outL) (i32.mul (local.get $i) (i32.const 4)))
          (f32.mul (f32.load (i32.add (local.get $inL) (i32.mul (local.get $i) (i32.const 4)))) (local.get $cur)))
        (f32.store (i32.add (local.get $outR) (i32.mul (local.get $i) (i32.const 4)))
          (f32.mul (f32.load (i32.add (local.get $inR) (i32.mul (local.get $i) (i32.const 4)))) (local.get $cur)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $frame)
      )
    )
    (f32.store (global.get $CUR_PTR) (local.get $cur))
  )
)

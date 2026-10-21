;; Audius Studio — Aurora Reverb (reference WASM effect).
;; Built to app/public/plugins/aurora-reverb.wasm by tools/wasm-plugins/build.mjs.
;;
;; A Freeverb-style stereo reverb: four damped feedback combs and two allpass
;; stages per channel, a stereo spread on the right channel and a mid/side
;; width control. No imports and no host calls: plain f32 arithmetic over
;; linear memory, so the module runs inside the generic AudioWorklet host
;; (app/public/plugins/wasm-fx-processor.js).
;;
;; ABI — see tools/wasm-plugins/README.md:
;;   memory               exported linear memory (4 pages = 256 KiB)
;;   init(sampleRate)     once before the first process()
;;   set_param(index, v)  normalised parameter value 0..1
;;   process(inL, inR, outL, outR, frames)
;;                        f32 de-interleaved buffers in this memory;
;;                        0..4095 is the host scratch area
;;
;; Parameters: 0 mix, 1 size, 2 damping, 3 width.
(module
  (memory (export "memory") 4)

  (global $scale (mut f32) (f32.const 1))
  (global $mix (mut f32) (f32.const 0.26))
  (global $fb (mut f32) (f32.const 0.91))
  (global $damp (mut f32) (f32.const 0.30))
  (global $width (mut f32) (f32.const 0.80))

  ;; Memory layout (bytes):
  ;;   0..4095       host scratch
  ;;   4096..53247   12 delay lines, 4096 bytes each (max 1024 samples)
  ;;   53248..63487  state: 12 x { i32 index, f32 lowpass store }
  ;;   63488..64511  tuned length of each line, in samples (scaled to the rate)
  (global $BUF_BASE i32 (i32.const 4096))
  (global $BUF_STRIDE i32 (i32.const 4096))
  (global $STATE_BASE i32 (i32.const 53248))
  (global $LEN_BASE i32 (i32.const 63488))

  ;; Damped feedback comb. State at $state: i32 index, then the f32 store.
  (func $comb (param $in f32) (param $buf i32) (param $len i32) (param $state i32) (result f32)
    (local $idx i32) (local $store f32) (local $out f32) (local $addr i32)
    (local.set $idx (i32.load (local.get $state)))
    (local.set $store (f32.load (i32.add (local.get $state) (i32.const 4))))
    (local.set $addr (i32.add (local.get $buf) (i32.mul (local.get $idx) (i32.const 4))))
    (local.set $out (f32.load (local.get $addr)))
    (local.set $store
      (f32.add (local.get $store)
        (f32.mul (global.get $damp) (f32.sub (local.get $out) (local.get $store)))))
    (f32.store (local.get $addr)
      (f32.add (local.get $in) (f32.mul (local.get $store) (global.get $fb))))
    (local.set $idx (i32.add (local.get $idx) (i32.const 1)))
    (if (i32.ge_s (local.get $idx) (local.get $len))
      (then (local.set $idx (i32.const 0))))
    (i32.store (local.get $state) (local.get $idx))
    (f32.store (i32.add (local.get $state) (i32.const 4)) (local.get $store))
    (local.get $out)
  )

  ;; Schroeder allpass with 0.5 feedback. State at $state: i32 index.
  (func $allpass (param $in f32) (param $buf i32) (param $len i32) (param $state i32) (result f32)
    (local $idx i32) (local $out f32) (local $addr i32)
    (local.set $idx (i32.load (local.get $state)))
    (local.set $addr (i32.add (local.get $buf) (i32.mul (local.get $idx) (i32.const 4))))
    (local.set $out (f32.load (local.get $addr)))
    (f32.store (local.get $addr)
      (f32.add (local.get $in) (f32.mul (local.get $out) (f32.const 0.5))))
    (local.set $idx (i32.add (local.get $idx) (i32.const 1)))
    (if (i32.ge_s (local.get $idx) (local.get $len))
      (then (local.set $idx (i32.const 0))))
    (i32.store (local.get $state) (local.get $idx))
    (f32.sub (local.get $out) (local.get $in))
  )

  ;; Tuned delay lengths of the Freeverb network, in samples at 44.1 kHz.
  (func $baseLen (param $i i32) (result f32)
    (local $v f32)
    (local.set $v (f32.const 464))
    (if (i32.eq (local.get $i) (i32.const 0)) (then (local.set $v (f32.const 1116))))
    (if (i32.eq (local.get $i) (i32.const 1)) (then (local.set $v (f32.const 1188))))
    (if (i32.eq (local.get $i) (i32.const 2)) (then (local.set $v (f32.const 1277))))
    (if (i32.eq (local.get $i) (i32.const 3)) (then (local.set $v (f32.const 1356))))
    (if (i32.eq (local.get $i) (i32.const 4)) (then (local.set $v (f32.const 1139))))
    (if (i32.eq (local.get $i) (i32.const 5)) (then (local.set $v (f32.const 1211))))
    (if (i32.eq (local.get $i) (i32.const 6)) (then (local.set $v (f32.const 1300))))
    (if (i32.eq (local.get $i) (i32.const 7)) (then (local.set $v (f32.const 1379))))
    (if (i32.eq (local.get $i) (i32.const 8)) (then (local.set $v (f32.const 556))))
    (if (i32.eq (local.get $i) (i32.const 9)) (then (local.set $v (f32.const 441))))
    (if (i32.eq (local.get $i) (i32.const 10)) (then (local.set $v (f32.const 579))))
    (if (i32.eq (local.get $i) (i32.const 11)) (then (local.set $v (f32.const 464))))
    (local.get $v)
  )

  (func (export "init") (param $sampleRate f32)
    (local $i i32) (local $len i32)
    (global.set $scale (f32.div (local.get $sampleRate) (f32.const 44100)))
    ;; Every delay line, state and length starts silent, so a reloaded node is clean.
    (memory.fill (i32.const 4096) (i32.const 0) (i32.const 60416))
    (local.set $i (i32.const 0))
    (block $done
      (loop $l
        (br_if $done (i32.ge_s (local.get $i) (i32.const 12)))
        (local.set $len
          (i32.trunc_f32_s
            (f32.mul (call $baseLen (local.get $i)) (global.get $scale))))
        (if (i32.lt_s (local.get $len) (i32.const 8)) (then (local.set $len (i32.const 8))))
        (if (i32.gt_s (local.get $len) (i32.const 1024)) (then (local.set $len (i32.const 1024))))
        (i32.store (i32.add (global.get $LEN_BASE) (i32.mul (local.get $i) (i32.const 4))) (local.get $len))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)
      )
    )
  )

  (func (export "set_param") (param $index i32) (param $value f32)
    (local $v f32)
    (local.set $v (f32.max (f32.const 0) (f32.min (f32.const 1) (local.get $value))))
    (block $end
      (block $case3
        (block $case2
          (block $case1
            (block $case0
              (br_table $case0 $case1 $case2 $case3 $end (local.get $index))
            )
            (global.set $mix (local.get $v))
            (return)
          )
          (global.set $fb (f32.add (f32.const 0.70) (f32.mul (f32.const 0.28) (local.get $v))))
          (return)
        )
        (global.set $damp (f32.add (f32.const 0.05) (f32.mul (f32.const 0.85) (local.get $v))))
        (return)
      )
      (global.set $width (local.get $v))
    )
  )

  (func (export "process") (param $inL i32) (param $inR i32) (param $outL i32) (param $outR i32) (param $frames i32)
    (local $i i32) (local $c i32)
    (local $xL f32) (local $xR f32) (local $wL f32) (local $wR f32)
    (local $mid f32) (local $side f32)
    (local $mix f32) (local $dry f32) (local $width f32)
    (local $buf i32) (local $len i32) (local $st i32) (local $k i32)
    (local.set $mix (global.get $mix))
    (local.set $dry (f32.sub (f32.const 1) (local.get $mix)))
    (local.set $width (global.get $width))
    (local.set $i (i32.const 0))
    (block $done
      (loop $frame
        (br_if $done (i32.ge_u (local.get $i) (local.get $frames)))
        (local.set $xL (f32.load (i32.add (local.get $inL) (i32.mul (local.get $i) (i32.const 4)))))
        (local.set $xR (f32.load (i32.add (local.get $inR) (i32.mul (local.get $i) (i32.const 4)))))
        (local.set $wL (f32.const 0))
        (local.set $wR (f32.const 0))
        (local.set $c (i32.const 0))
        (block $cdone
          (loop $cl
            (br_if $cdone (i32.ge_s (local.get $c) (i32.const 4)))
            (local.set $buf (i32.add (global.get $BUF_BASE) (i32.mul (local.get $c) (global.get $BUF_STRIDE))))
            (local.set $len (i32.load (i32.add (global.get $LEN_BASE) (i32.mul (local.get $c) (i32.const 4)))))
            (local.set $st (i32.add (global.get $STATE_BASE) (i32.mul (local.get $c) (i32.const 8))))
            (local.set $wL (f32.add (local.get $wL)
              (call $comb (f32.mul (local.get $xL) (f32.const 0.022)) (local.get $buf) (local.get $len) (local.get $st))))
            (local.set $k (i32.add (local.get $c) (i32.const 4)))
            (local.set $buf (i32.add (global.get $BUF_BASE) (i32.mul (local.get $k) (global.get $BUF_STRIDE))))
            (local.set $len (i32.load (i32.add (global.get $LEN_BASE) (i32.mul (local.get $k) (i32.const 4)))))
            (local.set $st (i32.add (global.get $STATE_BASE) (i32.mul (local.get $k) (i32.const 8))))
            (local.set $wR (f32.add (local.get $wR)
              (call $comb (f32.mul (local.get $xR) (f32.const 0.022)) (local.get $buf) (local.get $len) (local.get $st))))
            (local.set $c (i32.add (local.get $c) (i32.const 1)))
            (br $cl)
          )
        )
        (local.set $c (i32.const 0))
        (block $adone
          (loop $al
            (br_if $adone (i32.ge_s (local.get $c) (i32.const 2)))
            (local.set $buf (i32.add (global.get $BUF_BASE) (i32.mul (i32.add (local.get $c) (i32.const 8)) (global.get $BUF_STRIDE))))
            (local.set $len (i32.load (i32.add (global.get $LEN_BASE) (i32.mul (i32.add (local.get $c) (i32.const 8)) (i32.const 4)))))
            (local.set $st (i32.add (global.get $STATE_BASE) (i32.mul (i32.add (local.get $c) (i32.const 8)) (i32.const 8))))
            (local.set $wL (call $allpass (local.get $wL) (local.get $buf) (local.get $len) (local.get $st)))
            (local.set $k (i32.add (local.get $c) (i32.const 10)))
            (local.set $buf (i32.add (global.get $BUF_BASE) (i32.mul (local.get $k) (global.get $BUF_STRIDE))))
            (local.set $len (i32.load (i32.add (global.get $LEN_BASE) (i32.mul (local.get $k) (i32.const 4)))))
            (local.set $st (i32.add (global.get $STATE_BASE) (i32.mul (local.get $k) (i32.const 8))))
            (local.set $wR (call $allpass (local.get $wR) (local.get $buf) (local.get $len) (local.get $st)))
            (local.set $c (i32.add (local.get $c) (i32.const 1)))
            (br $al)
          )
        )
        ;; Stereo width on the wet signal, mid/side.
        (local.set $mid (f32.mul (f32.add (local.get $wL) (local.get $wR)) (f32.const 0.5)))
        (local.set $side (f32.mul (f32.mul (f32.sub (local.get $wL) (local.get $wR)) (f32.const 0.5)) (local.get $width)))
        (local.set $wL (f32.add (local.get $mid) (local.get $side)))
        (local.set $wR (f32.sub (local.get $mid) (local.get $side)))
        (local.set $xL (f32.add
          (f32.mul (local.get $xL) (local.get $dry))
          (f32.mul (f32.mul (local.get $wL) (f32.const 1.5)) (local.get $mix))))
        (local.set $xR (f32.add
          (f32.mul (local.get $xR) (local.get $dry))
          (f32.mul (f32.mul (local.get $wR) (f32.const 1.5)) (local.get $mix))))
        (f32.store (i32.add (local.get $outL) (i32.mul (local.get $i) (i32.const 4))) (local.get $xL))
        (f32.store (i32.add (local.get $outR) (i32.mul (local.get $i) (i32.const 4))) (local.get $xR))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $frame)
      )
    )
  )
)

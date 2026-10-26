;; Audius Studio — Echo Line (reference WASM effect).
;; Built to app/public/plugins/echo-line.wasm by tools/wasm-plugins/build.mjs.
;;
;; A tempo-free tape-style stereo delay: a long delay line per channel with
;; smoothed delay-time changes (no clicks while moving "time"), damped
;; feedback and a gentle saturation on the repeats. Same ABI as
;; aurora-reverb.wat; see tools/wasm-plugins/README.md.
;;
;; Parameters: 0 mix, 1 time, 2 feedback, 3 tone.
(module
  (memory (export "memory") 4)

  (global $sr (mut f32) (f32.const 44100))
  (global $mix (mut f32) (f32.const 0.28))
  (global $fb (mut f32) (f32.const 0.42))
  (global $tone (mut f32) (f32.const 0.65))
  (global $delaySec (mut f32) (f32.const 0.30))
  (global $curDelaySec (mut f32) (f32.const 0.30))

  ;; Memory layout:
  ;;   0..4095      host scratch
  ;;   4096..212991   two delay lines of 2 s max at 48 kHz (104448 bytes each)
  ;;   217088..       state: write index per channel (i32), lowpass store (f32)
  (global $L_BUF i32 (i32.const 4096))
  (global $R_BUF i32 (i32.const 108544))
  (global $LEN i32 (i32.const 26112)) ;; samples per line: 2 s at 48 kHz (104448 bytes)
  (global $L_IDX i32 (i32.const 217088))
  (global $L_LP i32 (i32.const 217092))
  (global $R_IDX i32 (i32.const 217100))
  (global $R_LP i32 (i32.const 217104))

  (func (export "init") (param $sampleRate f32)
    (global.set $sr (local.get $sampleRate))
    (memory.fill (i32.const 4096) (i32.const 0) (i32.const 213008))
    (i32.store (global.get $L_IDX) (i32.const 0))
    (i32.store (global.get $R_IDX) (i32.const 0))
    (f32.store (global.get $L_LP) (f32.const 0))
    (f32.store (global.get $R_LP) (f32.const 0))
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
          ;; 20 ms .. 1.9 s; the square curve puts the short times in reach.
          (global.set $delaySec
            (f32.add (f32.const 0.02)
              (f32.mul (f32.const 1.88) (f32.mul (local.get $v) (local.get $v)))))
          (return)
        )
        (global.set $fb (f32.mul (f32.const 0.88) (local.get $v)))
        (return)
      )
      (global.set $tone (f32.add (f32.const 0.05) (f32.mul (f32.const 0.95) (local.get $v))))
    )
  )

  ;; Reads one delay line at $delaySamples behind the write head, writes the new
  ;; sample, and returns the delayed value. Fractional reads are linear.
  (func $line (param $in f32) (param $buf i32) (param $idxPtr i32) (param $lpPtr i32) (param $delaySamples f32) (result f32)
    (local $idx i32) (local $read i32) (local $read2 i32) (local $frac f32)
    (local $a f32) (local $b f32) (local $out f32) (local $lp f32)
    (local.set $idx (i32.load (local.get $idxPtr)))
    (local.set $read
      (i32.sub (i32.add (local.get $idx) (global.get $LEN)) (i32.trunc_f32_s (local.get $delaySamples))))
    (local.set $read
      (i32.rem_s (i32.rem_s (local.get $read) (global.get $LEN)) (global.get $LEN)))
    (if (i32.lt_s (local.get $read) (i32.const 0))
      (then (local.set $read (i32.add (local.get $read) (global.get $LEN)))))
    (local.set $a (f32.load (i32.add (local.get $buf) (i32.mul (local.get $read) (i32.const 4)))))
    (local.set $read2 (i32.rem_s (i32.add (local.get $read) (i32.const 1)) (global.get $LEN)))
    (local.set $b (f32.load (i32.add (local.get $buf) (i32.mul (local.get $read2) (i32.const 4)))))
    (local.set $frac
      (f32.sub (local.get $delaySamples) (f32.convert_i32_s (i32.trunc_f32_s (local.get $delaySamples)))))
    (local.set $out (f32.add (local.get $a) (f32.mul (local.get $frac) (f32.sub (local.get $b) (local.get $a)))))
    ;; Damped feedback: one-pole low-pass on the repeat.
    (local.set $lp (f32.load (local.get $lpPtr)))
    (local.set $lp (f32.add (local.get $lp) (f32.mul (global.get $tone) (f32.sub (local.get $out) (local.get $lp)))))
    (f32.store (local.get $lpPtr) (local.get $lp))
    (f32.store (i32.add (local.get $buf) (i32.mul (local.get $idx) (i32.const 4)))
      (f32.add (local.get $in) (f32.mul (local.get $lp) (global.get $fb))))
    (local.set $idx (i32.rem_s (i32.add (local.get $idx) (i32.const 1)) (global.get $LEN)))
    (i32.store (local.get $idxPtr) (local.get $idx))
    (local.get $out)
  )

  (func (export "process") (param $inL i32) (param $inR i32) (param $outL i32) (param $outR i32) (param $frames i32)
    (local $i i32) (local $xL f32) (local $xR f32) (local $dL f32) (local $dR f32)
    (local $mix f32) (local $dry f32) (local $ds f32)
    (local.set $mix (global.get $mix))
    (local.set $dry (f32.sub (f32.const 1) (local.get $mix)))
    (local.set $ds (f32.mul (global.get $delaySec) (global.get $sr)))
    (local.set $i (i32.const 0))
    (block $done
      (loop $frame
        (br_if $done (i32.ge_u (local.get $i) (local.get $frames)))
        ;; Glide the delay length so a moving Time knob never clicks.
        (global.set $curDelaySec
          (f32.add (global.get $curDelaySec)
            (f32.mul (f32.const 0.0002) (f32.sub (global.get $delaySec) (global.get $curDelaySec)))))
        (local.set $ds (f32.mul (global.get $curDelaySec) (global.get $sr)))
        (local.set $xL (f32.load (i32.add (local.get $inL) (i32.mul (local.get $i) (i32.const 4)))))
        (local.set $xR (f32.load (i32.add (local.get $inR) (i32.mul (local.get $i) (i32.const 4)))))
        (local.set $dL (call $line (local.get $xL) (global.get $L_BUF) (global.get $L_IDX) (global.get $L_LP) (local.get $ds)))
        (local.set $dR (call $line (local.get $xR) (global.get $R_BUF) (global.get $R_IDX) (global.get $R_LP) (local.get $ds)))
        ;; Soft saturation on the wet path, then the dry/wet mix.
        (local.set $dL (f32.div (local.get $dL) (f32.add (f32.const 1) (f32.abs (local.get $dL)))))
        (local.set $dR (f32.div (local.get $dR) (f32.add (f32.const 1) (f32.abs (local.get $dR)))))
        (f32.store (i32.add (local.get $outL) (i32.mul (local.get $i) (i32.const 4)))
          (f32.add (f32.mul (local.get $xL) (local.get $dry)) (f32.mul (local.get $dL) (local.get $mix))))
        (f32.store (i32.add (local.get $outR) (i32.mul (local.get $i) (i32.const 4)))
          (f32.add (f32.mul (local.get $xR) (local.get $dry)) (f32.mul (local.get $dR) (local.get $mix))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $frame)
      )
    )
  )
)

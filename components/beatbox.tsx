"use client"

import * as React from "react"
import * as Tone from "tone"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Play, Square, Download, RefreshCw, Zap, Music2, ChevronDown } from 'lucide-react'
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/theme-toggle"

type BeatBoxProps = {
  defaultBpm?: number
}

type StepGrid = boolean[] // length 16

type BassNote = {
  on: boolean
  midi: number
}

type BassGrid = BassNote[] // length 16

type Pattern = {
  kick: StepGrid
  snare: StepGrid
  hat: StepGrid
  bass: BassGrid
}

type KickPresetKey = "808" | "909" | "punch" | "clicky" | "soft"
type SnarePresetKey = "tight" | "wide" | "clap" | "rim" | "snappy"
type HatPresetKey = "closed" | "shaker" | "metallic" | "open" | "ticky"
type BassPresetKey = "saw" | "square" | "fm" | "sub" | "reese"

const DEFAULT_BPM = 128
const STEPS = 16
const KEY_ROOT = "G2"
const SCALE: number[] = [0, 3, 5, 7, 10, 12, 15]

// Simple seeded RNG (mulberry32)
function rng(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function midiFrom(rootMidi: number, degree: number) {
  const idx = degree % SCALE.length
  const oct = Math.floor(degree / SCALE.length)
  return rootMidi + SCALE[idx] + 12 * oct
}

function noteToMidi(note: string) {
  return Tone.Frequency(note).toMidi()
}

function makeBasePattern(seed: number): Pattern {
  const rand = rng(seed)
  const kick: StepGrid = Array.from({ length: STEPS }, (_, i) => {
    if (i === 0 || i === 8) return true
    if (i === 12 && rand() > 0.4) return true
    if (i % 4 === 0 && rand() > 0.65) return true
    if (rand() > 0.92) return true
    return false
  })

  const snare: StepGrid = Array.from({ length: STEPS }, (_, i) => {
    if (i === 4 || i === 12) return true
    if ((i === 6 || i === 14) && rng(seed + i)() > 0.7) return true
    return false
  })

  const hat: StepGrid = Array.from({ length: STEPS }, (_, i) => {
    if (i % 2 === 0) return rand() > 0.15
    return rand() > 0.4
  })

  const rootMidi = noteToMidi(KEY_ROOT)
  const bass: BassGrid = Array.from({ length: STEPS }, (_, i) => {
    const on = i % 2 === 0 ? rng(seed + i)() > 0.35 : rng(seed + i * 13)() > 0.8
    const degree = i % 8 === 0 ? 7 : i % 4 === 0 ? 5 : i % 2 === 0 ? 3 : 1
    const midi = midiFrom(rootMidi, degree + (rand() > 0.8 ? 7 : 0))
    return { on, midi }
  })

  return { kick, snare, hat, bass }
}

function hypeUp(pattern: Pattern, seed: number): Pattern {
  const rand = rng(seed + 999)
  const hat = pattern.hat.map((v, i) => (i % 2 === 1 && rand() > 0.3 ? true : v))
  const snare = pattern.snare.map((v, i) => ((i === 3 || i === 7 || i === 11 || i === 15) && rand() > 0.6 ? true : v))
  const kick = pattern.kick.map((v, i) => (i % 4 === 2 && rand() > 0.6 ? true : v))
  const bass = pattern.bass.map((b, i) => {
    if (i % 4 === 2 && rand() > 0.7) return { ...b, on: true, midi: b.midi + (rand() > 0.5 ? 12 : -12) }
    return b
  })
  return { kick, snare, hat, bass }
}

export default function BeatBox({ defaultBpm = DEFAULT_BPM }: BeatBoxProps) {
  const [bpm, setBpm] = React.useState(defaultBpm)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [seed, setSeed] = React.useState<number>(() => Math.floor(Math.random() * 1_000_000))
  const [pattern, setPattern] = React.useState<Pattern>(() => makeBasePattern(seed))
  const [playhead, setPlayhead] = React.useState(0)
  const [isHyped, setIsHyped] = React.useState(true)

  // Preset selections
  const [kickPreset, setKickPreset] = React.useState<KickPresetKey>("909")
  const [snarePreset, setSnarePreset] = React.useState<SnarePresetKey>("tight")
  const [hatPreset, setHatPreset] = React.useState<HatPresetKey>("closed")
  const [bassPreset, setBassPreset] = React.useState<BassPresetKey>("saw")

  // Refs for Transport callback to read latest state
  const patternRef = React.useRef(pattern)
  const isHypedRef = React.useRef(isHyped)
  const seedRef = React.useRef(seed)
  const snarePresetRef = React.useRef(snarePreset)
  React.useEffect(() => void (patternRef.current = pattern), [pattern])
  React.useEffect(() => void (isHypedRef.current = isHyped), [isHyped])
  React.useEffect(() => void (seedRef.current = seed), [seed])
  React.useEffect(() => void (snarePresetRef.current = snarePreset), [snarePreset])

  // Tone node refs
  const kickRef = React.useRef<Tone.MembraneSynth | null>(null)
  const snareRef = React.useRef<Tone.NoiseSynth | Tone.MetalSynth | null>(null)
  const clapRef = React.useRef<Tone.MetalSynth | null>(null)
  const hatRef = React.useRef<Tone.NoiseSynth | Tone.MetalSynth | null>(null)
  const hatFilterRef = React.useRef<Tone.Filter | null>(null)
  const hatGainRef = React.useRef<Tone.Gain | null>(null)
  const bassRef = React.useRef<Tone.MonoSynth | Tone.FMSynth | null>(null)
  const reverbRef = React.useRef<Tone.Reverb | null>(null)
  const delayRef = React.useRef<Tone.PingPongDelay | null>(null)
  const distRef = React.useRef<Tone.Distortion | null>(null)
  const compRef = React.useRef<Tone.Compressor | null>(null)
  const masterBusRef = React.useRef<Tone.Gain | null>(null)
  const recordTapRef = React.useRef<Tone.Gain | null>(null)
  const recordInProgressRef = React.useRef(false)
  const initializedRef = React.useRef(false)

  const disposeNode = (node?: Tone.ToneAudioNode | null) => {
    try { node?.dispose?.() } catch {}
  }

  // Builders
  const createKick = React.useCallback((preset: KickPresetKey) => {
    const params: Record<KickPresetKey, Tone.MembraneSynthOptions> = {
      "808": { pitchDecay: 0.02, octaves: 6, envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.2 }, oscillator: { type: "sine" }, volume: -4 },
      "909": { pitchDecay: 0.008, octaves: 10, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 }, oscillator: { type: "sine" }, volume: -6 },
      punch: { pitchDecay: 0.01, octaves: 8, envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.08 }, oscillator: { type: "sine" }, volume: -5 },
      clicky: { pitchDecay: 0.004, octaves: 4, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 }, oscillator: { type: "sine" }, volume: -6 },
      soft: { pitchDecay: 0.012, octaves: 6, envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.08 }, oscillator: { type: "sine" }, volume: -8 },
    }
    return new Tone.MembraneSynth(params[preset]).connect(masterBusRef.current!)
  }, [])
  const replaceKick = React.useCallback((preset: KickPresetKey) => {
    disposeNode(kickRef.current)
    kickRef.current = createKick(preset)
  }, [createKick])

  const createSnare = React.useCallback((preset: SnarePresetKey) => {
    if (preset === "clap") {
      return new Tone.MetalSynth({
        frequency: 180,
        envelope: { attack: 0.001, decay: 0.18, release: 0.02 },
        harmonicity: 5.1,
        modulationIndex: 10,
        resonance: 300,
        octaves: 1.5,
      }).connect(new Tone.Gain(0.35).connect(masterBusRef.current!))
    }
    const settings: Record<Exclude<SnarePresetKey, "clap">, Tone.NoiseSynthOptions> = {
      tight: { noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.01 }, filterEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, baseFrequency: 2000, octaves: 1.5 } },
      wide: { noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.28, sustain: 0, release: 0.02 }, filterEnvelope: { attack: 0.001, decay: 0.24, sustain: 0, baseFrequency: 1500, octaves: 2 } },
      rim: { noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.01 }, filterEnvelope: { attack: 0.001, decay: 0.06, sustain: 0, baseFrequency: 2500, octaves: 1.2 } },
      snappy: { noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.02 }, filterEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, baseFrequency: 1800, octaves: 2.2 } },
    }
    return new Tone.NoiseSynth(settings[preset as Exclude<SnarePresetKey, "clap">]).connect(masterBusRef.current!)
  }, [])
  const replaceSnare = React.useCallback((preset: SnarePresetKey) => {
    disposeNode(snareRef.current)
    snareRef.current = createSnare(preset)
  }, [createSnare])

  const createHats = React.useCallback((preset: HatPresetKey) => {
    disposeNode(hatRef.current)
    disposeNode(hatFilterRef.current)
    if (!hatGainRef.current) {
      hatGainRef.current = new Tone.Gain(0.42).connect(masterBusRef.current!)
    }
    if (preset === "metallic") {
      const metal = new Tone.MetalSynth({
        frequency: 500,
        envelope: { attack: 0.001, decay: 0.07, release: 0.01 },
        harmonicity: 5,
        modulationIndex: 32,
        resonance: 6000,
        octaves: 2,
      }).connect(hatGainRef.current)
      hatRef.current = metal
      hatGainRef.current.gain.value = 0.28
      return
    }
    const noise = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: preset === "open" ? 0.22 : preset === "ticky" ? 0.04 : 0.06, sustain: 0, release: 0.01 },
    })
    const filter =
      preset === "shaker"
        ? new Tone.Filter({ type: "bandpass", frequency: 6500, Q: 1 })
        : new Tone.Filter({ type: "highpass", frequency: preset === "ticky" ? 10000 : 8000, rolloff: -24 })
    noise.connect(filter).connect(hatGainRef.current)
    hatRef.current = noise
    hatFilterRef.current = filter
    hatGainRef.current.gain.value =
      preset === "open" ? 0.5 : preset === "ticky" ? 0.38 : preset === "shaker" ? 0.45 : 0.42
  }, [])
  const replaceHats = React.useCallback((preset: HatPresetKey) => { createHats(preset) }, [createHats])

  const createBass = React.useCallback((preset: BassPresetKey) => {
    if (bassRef.current) disposeNode(bassRef.current)
    if (preset === "fm") {
      bassRef.current = new Tone.FMSynth({
        modulationIndex: 12,
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.15, release: 0.1 },
        modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.1 },
        harmonicity: 1.5,
        volume: -8,
      }).connect(masterBusRef.current!)
      return
    }
    const base: Tone.MonoSynthOptions = {
      filter: { type: "lowpass", Q: 1 },
      filterEnvelope: { attack: 0.01, decay: 0.22, sustain: 0.2, release: 0.12, baseFrequency: 80, octaves: 4 },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.1 },
      volume: -6,
    }
    const variants: Record<Exclude<BassPresetKey, "fm">, Tone.MonoSynthOptions> = {
      saw: { ...base, oscillator: { type: "sawtooth" } },
      square: { ...base, oscillator: { type: "square" } },
      sub: { ...base, oscillator: { type: "sine" }, filterEnvelope: { attack: 0.01, decay: 0.18, sustain: 0.3, release: 0.15, baseFrequency: 60, octaves: 3 }, volume: -8 },
      reese: {
        ...base,
        // @ts-expect-error allow fat osc
        oscillator: { type: "fatsawtooth", count: 3, spread: 20 },
        filter: { type: "lowpass", Q: 0.7 },
        filterEnvelope: { attack: 0.015, decay: 0.3, sustain: 0.25, release: 0.15, baseFrequency: 90, octaves: 5 },
        volume: -7,
      },
    }
    bassRef.current = new Tone.MonoSynth(variants[preset as Exclude<BassPresetKey, "fm">]).connect(masterBusRef.current!)
  }, [])
  const replaceBass = React.useCallback((preset: BassPresetKey) => { createBass(preset) }, [createBass])

  // Init audio graph
  const initAudio = React.useCallback(async () => {
    if (initializedRef.current) return
    await Tone.start()
    masterBusRef.current = new Tone.Gain(0.9)
    reverbRef.current = new Tone.Reverb({ decay: 2.8, wet: 0.18 }).toDestination()
    delayRef.current = new Tone.PingPongDelay({ delayTime: "8n", feedback: 0.2, wet: 0.1 }).toDestination()
    distRef.current = new Tone.Distortion({ distortion: 0.2, wet: 0.1 }).toDestination()
    compRef.current = new Tone.Compressor({ threshold: -14, ratio: 3, attack: 0.003, release: 0.25 }).toDestination()
    masterBusRef.current!.connect(reverbRef.current!)
    masterBusRef.current!.connect(delayRef.current!)
    masterBusRef.current!.connect(distRef.current!)
    masterBusRef.current!.connect(compRef.current!)
    recordTapRef.current = new Tone.Gain(1)
    masterBusRef.current!.connect(recordTapRef.current)

    replaceKick(kickPreset)
    replaceSnare(snarePreset)
    clapRef.current = new Tone.MetalSynth({
      frequency: 180,
      envelope: { attack: 0.001, decay: 0.15, release: 0.02 },
      harmonicity: 5.1, modulationIndex: 10, resonance: 200, octaves: 1.5,
    }).connect(new Tone.Gain(0.25).connect(masterBusRef.current))
    if (!hatGainRef.current) hatGainRef.current = new Tone.Gain(0.42).connect(masterBusRef.current!)
    replaceHats(hatPreset)
    replaceBass(bassPreset)

    Tone.Transport.bpm.value = bpm
    Tone.Transport.swing = 0.3
    Tone.Transport.swingSubdivision = "16n"

    let step = 0
    Tone.Transport.scheduleRepeat((time) => {
      setPlayhead((p) => (p + 1) % STEPS)
      const cur = isHypedRef.current ? hypeUp(patternRef.current, seedRef.current) : patternRef.current
      if (kickRef.current && cur.kick[step]) kickRef.current.triggerAttackRelease("C1", "8n", time)
      if (snareRef.current) {
        if (cur.snare[step]) snareRef.current.triggerAttackRelease("16n", time)
        if (clapRef.current && (step === 4 || step === 12) && snarePresetRef.current !== "clap") {
          clapRef.current.triggerAttackRelease("8n", time, 0.5)
        }
      }
      if (hatRef.current && cur.hat[step]) hatRef.current.triggerAttackRelease("16n", time, 0.9)
      if (bassRef.current) {
        const b = cur.bass[step]
        if (b.on) bassRef.current.triggerAttackRelease(Tone.Frequency(b.midi, "midi"), "8n", time, 0.8)
      }
      step = (step + 1) % STEPS
    }, "16n")

    initializedRef.current = true
  }, [bpm, kickPreset, snarePreset, hatPreset, bassPreset, replaceKick, replaceSnare, replaceHats, replaceBass])

  React.useEffect(() => { if (initializedRef.current) Tone.Transport.bpm.rampTo(bpm, 0.2) }, [bpm])

  React.useEffect(() => {
    return () => {
      try {
        Tone.Transport.cancel(0)
        disposeNode(kickRef.current); disposeNode(snareRef.current); disposeNode(clapRef.current)
        disposeNode(hatRef.current); disposeNode(hatFilterRef.current); disposeNode(hatGainRef.current)
        disposeNode(bassRef.current); disposeNode(reverbRef.current); disposeNode(delayRef.current)
        disposeNode(distRef.current); disposeNode(compRef.current); disposeNode(masterBusRef.current)
        disposeNode(recordTapRef.current)
      } catch {}
    }
  }, [])

  React.useEffect(() => { if (initializedRef.current) replaceKick(kickPreset) }, [kickPreset, replaceKick])
  React.useEffect(() => { if (initializedRef.current) replaceSnare(snarePreset) }, [snarePreset, replaceSnare])
  React.useEffect(() => { if (initializedRef.current) replaceHats(hatPreset) }, [hatPreset, replaceHats])
  React.useEffect(() => { if (initializedRef.current) replaceBass(bassPreset) }, [bassPreset, replaceBass])

  const togglePlay = async () => {
    if (!initializedRef.current) await initAudio()
    if (Tone.Transport.state !== "started") {
      setIsPlaying(true)
      await Tone.start()
      Tone.Transport.start("+0.05")
    } else {
      setIsPlaying(false)
      Tone.Transport.stop()
      setPlayhead(0)
    }
  }

  const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))

  const downloadCurrentLoop = async () => {
    if (!initializedRef.current) await initAudio()
    if (recordInProgressRef.current) return
    recordInProgressRef.current = true
    try {
      const recorder = new Tone.Recorder()
      recordTapRef.current?.connect(recorder)
      const wasPlaying = Tone.Transport.state === "started"
      await recorder.start()
      if (!wasPlaying) {
        await Tone.start()
        Tone.Transport.start("+0.01")
      }
      const beats = 8
      const durationMs = (60 / bpm) * beats * 1000
      await wait(durationMs)
      if (!wasPlaying) {
        Tone.Transport.stop()
        setPlayhead(0)
      }
      const blob = await recorder.stop()
      if (blob) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = "beatbox-gpt5.wav"
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
      }
      recordTapRef.current?.disconnect(recorder)
      recorder.dispose()
    } catch (e) {
      try { /* @ts-expect-error */ recordTapRef.current?.disconnect() } catch {}
      console.error(e)
    } finally {
      recordInProgressRef.current = false
    }
  }

  const regenerate = (newSeed?: number) => {
    const s = newSeed ?? Math.floor(Math.random() * 1_000_000)
    setSeed(s)
    setPattern(makeBasePattern(s))
  }

  const setGridCell = (row: "kick" | "snare" | "hat" | "bass", i: number) => {
    setPattern((prev) => {
      const next = { ...prev }
      if (row === "bass") {
        const b = [...prev.bass]; b[i] = { ...b[i], on: !b[i].on }; next.bass = b
      } else {
        const r = [...(prev as any)[row]]; r[i] = !r[i]; (next as any)[row] = r
      }
      return next
    })
  }

  const activePattern = isHyped ? hypeUp(pattern, seed) : pattern

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 grid place-items-center">
            <Music2 className="size-5" />
            <span className="sr-only">{'BeatBox logo'}</span>
          </div>
          <div>
            <CardTitle className="flex items-center gap-2">
              {"BeatBox"}
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 ml-1">
                {"GPT-5 Celebration"}
              </span>
            </CardTitle>
            <CardDescription className="text-neutral-600 dark:text-neutral-400">
              {"Generate and tweak a futuristic, energetic beat — all in your browser."}
            </CardDescription>
          </div>
        </div>
        <ThemeToggle />
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Top controls */}
        <div className="relative -mx-6 p-3 md:p-4 border-y border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/50 md:px-6">
          <h3 className="sr-only">{'Primary controls'}</h3>
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={isPlaying ? "Stop" : "Play"}
                      onClick={togglePlay}
                      className={cn(
                        "min-w-24",
                        isPlaying
                          ? "bg-neutral-900 hover:bg-neutral-800 text-white dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                          : ""
                      )}
                    >
                      {isPlaying ? (
                        <>
                          <Square className="mr-2 size-4" />
                          {"Stop"}
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 size-4" />
                          {"Play"}
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">{'Audio starts after you press Play (browser policy).'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <Button variant="outline" onClick={() => regenerate()} aria-label="Regenerate pattern">
                <RefreshCw className="mr-2 size-4" />
                {"Regenerate"}
              </Button>

              <Button variant="outline" onClick={downloadCurrentLoop} aria-label="Download as WAV">
                <Download className="mr-2 size-4" />
                {"Download"}
              </Button>
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-3">
              <div className="grid gap-1">
                <Label htmlFor="bpm" className="text-neutral-700 dark:text-neutral-300">{'Tempo (BPM)'}</Label>
                <div className="flex items-center gap-3">
                  <Slider id="bpm" min={90} max={160} step={1} value={[bpm]} onValueChange={([v]) => setBpm(v)} className="w-48" />
                  <div className="w-12 text-right tabular-nums text-neutral-800 dark:text-neutral-200">{bpm}</div>
                </div>
              </div>
              <div className="h-10 w-px bg-neutral-200 dark:bg-neutral-700" />
              <div className="flex items-center gap-2">
                <Switch id="hype" checked={isHyped} onCheckedChange={setIsHyped} />
                <Label htmlFor="hype" className="flex items-center gap-1 text-neutral-700 dark:text-neutral-300">
                  <Zap className="size-4 text-neutral-700 dark:text-neutral-300" />
                  {"Hype"}
                </Label>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{'Sequencer'}</div>

        {/* Sequencer rows */}
        <SequencerRow
          name="Kick"
          color="bg-neutral-900 dark:bg-neutral-100"
          steps={activePattern.kick}
          playhead={playhead}
          onToggle={(i) => setGridCell("kick", i)}
          control={
            <PresetSelect
              id="kick-preset"
              value={kickPreset}
              onChange={(v) => setKickPreset(v as KickPresetKey)}
              options={[
                { value: "808", label: "808" },
                { value: "909", label: "909" },
                { value: "punch", label: "Punch" },
                { value: "clicky", label: "Clicky" },
                { value: "soft", label: "Soft" },
              ]}
            />
          }
        />
        <SequencerRow
          name="Snare"
          color="bg-neutral-700 dark:bg-neutral-300"
          steps={activePattern.snare}
          playhead={playhead}
          onToggle={(i) => setGridCell("snare", i)}
          control={
            <PresetSelect
              id="snare-preset"
              value={snarePreset}
              onChange={(v) => setSnarePreset(v as SnarePresetKey)}
              options={[
                { value: "tight", label: "Tight" },
                { value: "wide", label: "Wide" },
                { value: "clap", label: "Clap" },
                { value: "rim", label: "Rim" },
                { value: "snappy", label: "Snappy" },
              ]}
            />
          }
        />
        <SequencerRow
          name="Hats"
          color="bg-neutral-500 dark:bg-neutral-400"
          steps={activePattern.hat}
          playhead={playhead}
          onToggle={(i) => setGridCell("hat", i)}
          control={
            <PresetSelect
              id="hat-preset"
              value={hatPreset}
              onChange={(v) => setHatPreset(v as HatPresetKey)}
              options={[
                { value: "closed", label: "Closed" },
                { value: "shaker", label: "Shaker" },
                { value: "metallic", label: "Metallic" },
                { value: "open", label: "Open" },
                { value: "ticky", label: "Ticky" },
              ]}
            />
          }
        />
        <SequencerRow
          name="Bass"
          color="bg-neutral-600 dark:bg-neutral-200"
          steps={activePattern.bass.map((b) => b.on)}
          playhead={playhead}
          onToggle={(i) => setGridCell("bass", i)}
          control={
            <PresetSelect
              id="bass-preset"
              value={bassPreset}
              onChange={(v) => setBassPreset(v as BassPresetKey)}
              options={[
                { value: "saw", label: "Saw" },
                { value: "square", label: "Square" },
                { value: "fm", label: "FM" },
                { value: "sub", label: "Sub" },
                { value: "reese", label: "Reese" },
              ]}
            />
          }
        />
      </CardContent>
    </Card>
  )
}

function PresetSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  const current = options.find((o) => o.value === value)?.label ?? value

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
            }
            if (e.key === "Escape") {
              e.stopPropagation()
              setOpen(false)
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-xs font-medium text-neutral-800 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-neutral-50 focus:outline-none"
        >
          <span>{current}</span>
          <ChevronDown className="size-3.5 text-neutral-500 dark:text-neutral-400" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-44 p-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800"
        align="start"
      >
        <ul role="listbox" aria-labelledby={id} className="max-h-56 overflow-auto py-1">
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors",
                    active
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200"
                  )}
                >
                  {opt.label}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function SequencerRow({
  name,
  color,
  steps,
  playhead,
  onToggle,
  control,
}: {
  name: string
  color: string
  steps: boolean[]
  playhead: number
  onToggle: (i: number) => void
  control?: React.ReactNode
}) {
  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className={cn("size-3 rounded-sm", color)} />
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{name}</span>
          {control}
        </div>
        <div className="text-[10px] text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{'16 steps • 4/4'}</div>
      </div>
      <div className="grid grid-cols-16 gap-1.5 sm:gap-2">
        {steps.map((on, i) => {
          const isBeat = i % 4 === 0
          const isNow = playhead === i
          return (
            <button
              key={i}
              aria-label={`${name} step ${i + 1} ${on ? "on" : "off"}`}
              onClick={() => onToggle(i)}
              className={cn(
                "relative h-9 sm:h-10 rounded-md border transition-colors",
                on
                  ? "bg-neutral-900 border-neutral-900 text-white dark:bg-neutral-100 dark:border-neutral-100 dark:text-neutral-900"
                  : "bg-white border-neutral-200 text-neutral-800 dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-200",
                isBeat &&
                  "after:absolute after:-top-1.5 after:left-1/2 after:h-1.5 after:w-px after:-translate-x-1/2 after:bg-neutral-200 dark:after:bg-neutral-700",
                isNow && "ring-2 ring-offset-2 ring-neutral-400 dark:ring-neutral-500 dark:ring-offset-neutral-900"
              )}
            >
              <span className="sr-only">{`${name} step ${i + 1}`}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

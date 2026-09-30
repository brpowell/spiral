import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "../common/Button/Button";
import { Checkbox } from "../common/Checkbox/Checkbox";
import { NativeSelect } from "../common/NativeSelect/NativeSelect";
import { Slider } from "../common/Slider/Slider";
import { TextInput } from "../common/TextInput/TextInput";
import {
  IconNext,
  IconPause,
  IconPlay,
  IconPrevious,
  IconRepeat,
  IconShuffle,
} from "../icons";
import {
  formatPitch,
  formatSemitones,
  parseRecipe,
  recipeExport,
  SOUND_PRESETS,
  SPIRAL_PRESET,
  TRANSPORT_ACTIONS,
  type MusicalInterval,
  type OscillatorWave,
  type SoundPreset,
  type TransportAction,
  type TransportSoundRecipe,
} from "../../lib/transportSignature/recipe";
import {
  playTransportSound,
  renderTransportSound,
} from "../../lib/transportSignature/synthesize";
import {
  encodeWavPcm16,
  formatPeakDb,
  peakDb,
} from "../../lib/transportSignature/wav";
import { zipStored } from "../../lib/transportSignature/zipStore";
import "../playback/playbackControl.css";
import "../playback/PlaybackTransport/PlaybackTransport.css";
import "./SoundLabShell.css";

const DRAFT_KEY = "spiral.soundLab.draft";

const ACTION_LABEL: Record<TransportAction, string> = {
  play: "Play",
  pause: "Pause",
  previous: "Previous",
  next: "Next",
  shuffle: "Shuffle",
  repeat: "Repeat",
};

const INTERVAL_OPTIONS: { value: MusicalInterval; label: string }[] = [
  { value: "unison", label: "Unison" },
  { value: "majorThird", label: "Major third" },
  { value: "fourth", label: "Fourth" },
  { value: "fifth", label: "Fifth" },
  { value: "octave", label: "Octave" },
];

function readDraft(): TransportSoundRecipe | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return parseRecipe(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function initialLabState(): {
  recipe: TransportSoundRecipe;
  presetId: string | null;
} {
  const draft = readDraft();
  if (draft) return { recipe: draft, presetId: null };
  return {
    recipe: structuredClone(SPIRAL_PRESET.recipe),
    presetId: SPIRAL_PRESET.id,
  };
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function fileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "transport-signature";
}

function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer): void {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const style = getComputedStyle(canvas);
  ctx.strokeStyle = style.borderTopColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  const data = buffer.getChannelData(0);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const step = data.length / width;
  for (let x = 0; x < width; x++) {
    const start = Math.floor(x * step);
    const end = Math.min(data.length, Math.floor((x + 1) * step));
    let min = 1;
    let max = -1;
    for (let i = start; i < end; i++) {
      const sample = data[i] ?? 0;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    const y1 = (1 - max) * 0.5 * height;
    const y2 = (1 - min) * 0.5 * height;
    ctx.moveTo(x + 0.5, y1);
    ctx.lineTo(x + 0.5, y2);
  }
  ctx.stroke();
}

export function SoundLabShell() {
  const [seed] = useState(initialLabState);
  const [recipe, setRecipe] = useState(seed.recipe);
  const [presetId, setPresetId] = useState<string | null>(seed.presetId);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [peakLabel, setPeakLabel] = useState("Rendering…");
  const [status, setStatus] = useState<string | null>(null);
  const [exportingWav, setExportingWav] = useState(false);
  const recipeRef = useRef(recipe);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const statusTimer = useRef<number | null>(null);
  recipeRef.current = recipe;

  const note = (message: string) => {
    setStatus(message);
    if (statusTimer.current != null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), 3200);
  };

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(recipe));
  }, [recipe]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let timer = 0;
    const draw = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void renderTransportSound(recipe, "play")
          .then((buffer) => {
            if (cancelled) return;
            if (canvasRef.current) drawWaveform(canvasRef.current, buffer);
            setPeakLabel(formatPeakDb(peakDb(buffer.getChannelData(0))));
          })
          .catch(() => {
            if (!cancelled) setPeakLabel("Couldn't render");
          });
      }, 50);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [recipe]);

  const patch = (next: TransportSoundRecipe) => {
    setPresetId(null);
    recipeRef.current = next;
    setRecipe(next);
  };

  const audition = (action: TransportAction = "play") => {
    playTransportSound(recipeRef.current, action);
  };

  const applyPreset = (preset: SoundPreset) => {
    const next = structuredClone(preset.recipe);
    setPresetId(preset.id);
    recipeRef.current = next;
    setRecipe(next);
    playTransportSound(next, "play");
  };

  const downloadRecipe = () => {
    const safe = parseRecipe(recipe) ?? recipe;
    const blob = new Blob(
      [`${JSON.stringify(recipeExport(safe), null, 2)}\n`],
      {
        type: "application/json",
      },
    );
    downloadBlob("transport-signature.json", blob);
    note("Downloaded the recipe. This lab does not change the app's sounds.");
  };

  const downloadWav = async (actions: readonly TransportAction[]) => {
    setExportingWav(true);
    try {
      const current = recipeRef.current;
      const slug = fileSlug(current.name);
      const files = await Promise.all(
        actions.map(async (action) => {
          const buffer = await renderTransportSound(current, action);
          return {
            name: `${slug}-${action}.wav`,
            data: encodeWavPcm16(buffer.getChannelData(0), buffer.sampleRate),
          };
        }),
      );
      if (files.length === 1) {
        const file = files[0];
        downloadBlob(file.name, new Blob([file.data], { type: "audio/wav" }));
        note("Downloaded the play WAV.");
        return;
      }
      const zip = zipStored(files);
      downloadBlob(
        `${slug}-transport.zip`,
        new Blob([zip], { type: "application/zip" }),
      );
      note("Downloaded a WAV for each control, including pitch offsets.");
    } catch {
      note("Couldn't render the WAVs.");
    } finally {
      setExportingWav(false);
    }
  };

  const copyRecipe = async () => {
    const safe = parseRecipe(recipeRef.current) ?? recipeRef.current;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(recipeExport(safe), null, 2),
      );
      note("Copied the recipe.");
    } catch {
      note("Couldn't copy the recipe.");
    }
  };

  const importRecipe = async (file: File) => {
    try {
      const parsed = parseRecipe(JSON.parse(await file.text()) as unknown);
      if (!parsed) {
        note("That file isn't a signature recipe.");
        return;
      }
      patch(parsed);
      note(`Loaded ${parsed.name}.`);
    } catch {
      note("Couldn't read that file.");
    }
  };

  return (
    <div className="sound-lab">
      <aside className="sound-lab__controls">
        <header className="sound-lab__header">
          <h1 className="sound-lab__title">Sound Lab</h1>
          <p className="sound-lab__subtitle">
            Shape a short signature. Releasing a slider plays it here. Nothing
            in this window is wired to the app.
          </p>
        </header>

        <section className="sound-lab__section">
          <h2 className="sound-lab__section-title">Starting points</h2>
          <div className="sound-lab__presets">
            {SOUND_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={
                  presetId === preset.id
                    ? "sound-lab__preset sound-lab__preset--active"
                    : "sound-lab__preset"
                }
                aria-pressed={presetId === preset.id}
                onClick={() => applyPreset(preset)}
              >
                <span className="sound-lab__preset-name">{preset.name}</span>
                <span className="sound-lab__preset-desc">
                  {preset.description}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="sound-lab__section">
          <h2 className="sound-lab__section-title">Voice</h2>
          <ParamSlider
            label="Level"
            min={0}
            max={0.8}
            step={0.01}
            value={recipe.masterGain}
            display={recipe.masterGain.toFixed(2)}
            onChange={(masterGain) => patch({ ...recipe, masterGain })}
            onAudition={() => audition()}
          />
          <ParamSlider
            label="Length"
            min={24}
            max={320}
            step={1}
            value={recipe.durationMs}
            display={`${Math.round(recipe.durationMs)} ms`}
            onChange={(durationMs) => patch({ ...recipe, durationMs })}
            onAudition={() => audition()}
          />
        </section>

        <section className="sound-lab__section">
          <div className="sound-lab__section-head">
            <h2 className="sound-lab__section-title">Tone</h2>
            <Checkbox
              checked={recipe.body.enabled}
              onChange={(event) => {
                const next = {
                  ...recipe,
                  body: { ...recipe.body, enabled: event.target.checked },
                };
                patch(next);
                if (event.target.checked) playTransportSound(next, "play");
              }}
            >
              On
            </Checkbox>
          </div>
          <NativeSelect
            aria-label="Wave"
            value={recipe.body.wave}
            disabled={!recipe.body.enabled}
            options={[
              { value: "sine" as OscillatorWave, label: "Sine" },
              { value: "triangle" as OscillatorWave, label: "Triangle" },
            ]}
            onChange={(wave) => {
              const next = { ...recipe, body: { ...recipe.body, wave } };
              patch(next);
              playTransportSound(next, "play");
            }}
          />
          <ParamSlider
            label="Start"
            min={80}
            max={4000}
            step={1}
            value={recipe.body.startHz}
            display={formatPitch(recipe.body.startHz)}
            disabled={!recipe.body.enabled}
            onChange={(startHz) =>
              patch({ ...recipe, body: { ...recipe.body, startHz } })
            }
            onAudition={() => audition()}
          />
          <ParamSlider
            label="End"
            min={80}
            max={4000}
            step={1}
            value={recipe.body.endHz}
            display={formatPitch(recipe.body.endHz)}
            disabled={!recipe.body.enabled}
            onChange={(endHz) =>
              patch({ ...recipe, body: { ...recipe.body, endHz } })
            }
            onAudition={() => audition()}
          />
          <ParamSlider
            label="Body"
            min={0}
            max={1}
            step={0.01}
            value={recipe.body.gain}
            display={recipe.body.gain.toFixed(2)}
            disabled={!recipe.body.enabled}
            onChange={(gain) =>
              patch({ ...recipe, body: { ...recipe.body, gain } })
            }
            onAudition={() => audition()}
          />
          <ParamSlider
            label="Attack"
            min={0}
            max={80}
            step={1}
            value={recipe.body.attackMs}
            display={`${Math.round(recipe.body.attackMs)} ms`}
            disabled={!recipe.body.enabled}
            onChange={(attackMs) =>
              patch({ ...recipe, body: { ...recipe.body, attackMs } })
            }
            onAudition={() => audition()}
          />
          <ParamSlider
            label="Tone"
            min={400}
            max={14000}
            step={10}
            value={recipe.body.toneHz}
            display={`${Math.round(recipe.body.toneHz)} Hz`}
            disabled={!recipe.body.enabled}
            onChange={(toneHz) =>
              patch({ ...recipe, body: { ...recipe.body, toneHz } })
            }
            onAudition={() => audition()}
          />
        </section>

        <section className="sound-lab__section">
          <div className="sound-lab__section-head">
            <h2 className="sound-lab__section-title">Overtone</h2>
            <Checkbox
              checked={recipe.overtone.enabled}
              onChange={(event) => {
                const next = {
                  ...recipe,
                  overtone: {
                    ...recipe.overtone,
                    enabled: event.target.checked,
                  },
                };
                patch(next);
                if (event.target.checked) playTransportSound(next, "play");
              }}
            >
              On
            </Checkbox>
          </div>
          <NativeSelect
            aria-label="Interval"
            value={recipe.overtone.interval}
            disabled={!recipe.overtone.enabled}
            options={INTERVAL_OPTIONS}
            onChange={(interval) => {
              const next = {
                ...recipe,
                overtone: { ...recipe.overtone, interval },
              };
              patch(next);
              playTransportSound(next, "play");
            }}
          />
          <ParamSlider
            label="Level"
            min={0}
            max={1}
            step={0.01}
            value={recipe.overtone.gain}
            display={recipe.overtone.gain.toFixed(2)}
            disabled={!recipe.overtone.enabled}
            onChange={(gain) =>
              patch({ ...recipe, overtone: { ...recipe.overtone, gain } })
            }
            onAudition={() => audition()}
          />
          <ParamSlider
            label="Detune"
            min={-40}
            max={40}
            step={1}
            value={recipe.overtone.detuneCents}
            display={`${Math.round(recipe.overtone.detuneCents)} cents`}
            disabled={!recipe.overtone.enabled}
            onChange={(detuneCents) =>
              patch({
                ...recipe,
                overtone: { ...recipe.overtone, detuneCents },
              })
            }
            onAudition={() => audition()}
          />
        </section>

        <section className="sound-lab__section">
          <div className="sound-lab__section-head">
            <h2 className="sound-lab__section-title">Click</h2>
            <Checkbox
              checked={recipe.click.enabled}
              onChange={(event) => {
                const next = {
                  ...recipe,
                  click: { ...recipe.click, enabled: event.target.checked },
                };
                patch(next);
                if (event.target.checked) playTransportSound(next, "play");
              }}
            >
              On
            </Checkbox>
          </div>
          <ParamSlider
            label="Level"
            min={0}
            max={1}
            step={0.01}
            value={recipe.click.gain}
            display={recipe.click.gain.toFixed(2)}
            disabled={!recipe.click.enabled}
            onChange={(gain) =>
              patch({ ...recipe, click: { ...recipe.click, gain } })
            }
            onAudition={() => audition()}
          />
          <ParamSlider
            label="Length"
            min={1}
            max={28}
            step={0.5}
            value={recipe.click.durationMs}
            display={`${recipe.click.durationMs.toFixed(1)} ms`}
            disabled={!recipe.click.enabled}
            onChange={(durationMs) =>
              patch({ ...recipe, click: { ...recipe.click, durationMs } })
            }
            onAudition={() => audition()}
          />
          <ParamSlider
            label="Highpass"
            min={400}
            max={12000}
            step={10}
            value={recipe.click.highpassHz}
            display={`${Math.round(recipe.click.highpassHz)} Hz`}
            disabled={!recipe.click.enabled}
            onChange={(highpassHz) =>
              patch({ ...recipe, click: { ...recipe.click, highpassHz } })
            }
            onAudition={() => audition()}
          />
        </section>

        <section className="sound-lab__section">
          <div className="sound-lab__section-head">
            <h2 className="sound-lab__section-title">Per control</h2>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                const next = {
                  ...recipe,
                  actionSemitones: {
                    play: 0,
                    pause: 0,
                    previous: 0,
                    next: 0,
                    shuffle: 0,
                    repeat: 0,
                  },
                };
                patch(next);
                playTransportSound(next, "play");
              }}
            >
              Reset
            </Button>
          </div>
          <p className="sound-lab__hint">
            Leave these at zero for one signature. Nudge next up and previous
            down if the controls should feel directional.
          </p>
          {TRANSPORT_ACTIONS.map((action) => (
            <ParamSlider
              key={action}
              label={ACTION_LABEL[action]}
              min={-12}
              max={12}
              step={1}
              value={recipe.actionSemitones[action]}
              display={formatSemitones(recipe.actionSemitones[action])}
              onChange={(semitones) =>
                patch({
                  ...recipe,
                  actionSemitones: {
                    ...recipe.actionSemitones,
                    [action]: semitones,
                  },
                })
              }
              onAudition={() => audition(action)}
            />
          ))}
        </section>
      </aside>

      <div className="sound-lab__stage">
        <div className="sound-lab__stage-card">
          <label className="sound-lab__name">
            <span className="sound-lab__section-title">Name</span>
            <TextInput
              value={recipe.name}
              aria-label="Signature name"
              onChange={(event) => {
                const next = {
                  ...recipe,
                  name: event.target.value.slice(0, 60),
                };
                recipeRef.current = next;
                setRecipe(next);
                setPresetId(null);
              }}
            />
          </label>

          <div className="sound-lab__wave-wrap">
            <canvas
              ref={canvasRef}
              className="sound-lab__wave"
              aria-hidden="true"
            />
            <p className="sound-lab__wave-meta">Play sound · {peakLabel}</p>
          </div>

          <div
            className="playback-transport sound-lab__transport"
            aria-label="Preview"
          >
            <PreviewButton label="Shuffle" onClick={() => audition("shuffle")}>
              <IconShuffle />
            </PreviewButton>
            <PreviewButton
              label="Previous"
              onClick={() => audition("previous")}
            >
              <IconPrevious />
            </PreviewButton>
            <Button
              variant="primary"
              size="md"
              iconOnly
              className="playback-btn playback-btn--play"
              aria-label={previewPlaying ? "Audition pause" : "Audition play"}
              onClick={() => {
                const action = previewPlaying ? "pause" : "play";
                setPreviewPlaying((playing) => !playing);
                playTransportSound(recipeRef.current, action);
              }}
            >
              {previewPlaying ? <IconPause /> : <IconPlay />}
            </Button>
            <PreviewButton label="Next" onClick={() => audition("next")}>
              <IconNext />
            </PreviewButton>
            <PreviewButton label="Repeat" onClick={() => audition("repeat")}>
              <IconRepeat />
            </PreviewButton>
          </div>
          <p className="sound-lab__hint">
            Audition only. The transport plays its own sound files.
          </p>

          <div className="sound-lab__exports">
            <Button variant="primary" size="sm" onClick={downloadRecipe}>
              Download recipe
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={exportingWav}
              onClick={() => {
                void downloadWav(["play"]);
              }}
            >
              Download WAV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={exportingWav}
              onClick={() => {
                void downloadWav(TRANSPORT_ACTIONS);
              }}
            >
              Download all WAVs
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void copyRecipe()}>
              Copy recipe
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              Import recipe
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importRecipe(file);
              }}
            />
          </div>
          <p className="sound-lab__hint">
            Download all WAVs when controls are pitched apart. The zip has one
            file per button.
          </p>
          {status ? <p className="sound-lab__status">{status}</p> : null}
        </div>
      </div>
    </div>
  );
}

function PreviewButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="secondary"
      size="md"
      iconOnly
      className="playback-btn"
      aria-label={`Audition ${label.toLowerCase()}`}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  disabled,
  onChange,
  onAudition,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onAudition: () => void;
}) {
  const id = useId();
  const audition = () => {
    if (!disabled) onAudition();
  };
  return (
    <div
      className={["sound-lab__param", disabled && "sound-lab__param--disabled"]
        .filter(Boolean)
        .join(" ")}
    >
      <label htmlFor={id}>{label}</label>
      <Slider
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        showValueTooltip
        formatValueTooltip={() => display}
        aria-valuetext={display}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(_event: PointerEvent<HTMLInputElement>) => audition()}
        onKeyUp={(event: KeyboardEvent<HTMLInputElement>) => {
          if (
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            event.key === "ArrowUp" ||
            event.key === "ArrowDown" ||
            event.key === "Home" ||
            event.key === "End"
          ) {
            audition();
          }
        }}
      />
      <span className="sound-lab__param-readout">{display}</span>
    </div>
  );
}

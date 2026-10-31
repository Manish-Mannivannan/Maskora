"use client";

/**
 * Finishes: every finish layer with its mask page, its target printed page
 * and whether it can render; and, for the selected layer, its type, target,
 * mask interpretation and registration offset (architecture §7.4). Every
 * mask and target names its file, so masks from separate PDFs stay clear.
 */
import { useEffect, useState } from "react";
import { usePageSummaries, pageName } from "@/features/document/usePages";
import { frameOf, maskAlphaUsable } from "@/finish/pipeline";
import { registrationWarnings } from "@/finish/registration";
import {
  DEFAULT_INTERPRETATION,
  FINISH_NAMES,
  FINISH_TYPES,
  layerProblem,
  pageKey,
  type FinishLayer,
  type FinishType,
} from "@/project/model";
import { useProject } from "@/project/ProjectContext";

/** A number input that keeps what is typed and commits only finite values. */
function NumberField({
  value,
  onCommit,
  testid,
  step,
  min,
  max,
}: {
  value: number;
  onCommit: (v: number) => void;
  testid: string;
  step: number;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  // The store's value changed elsewhere (reset, another field): show it.
  if (shown !== value) {
    setShown(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <input
      type="number"
      data-testid={testid}
      step={step}
      min={min}
      max={max}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(v)) onCommit(v);
      }}
    />
  );
}

/** Whether the layer's mask page has usable alpha; null while checking. */
function useAlphaUsable(layer: FinishLayer) {
  const [{ sources }, store] = useProject();
  const summaries = usePageSummaries();
  const [usable, setUsable] = useState<boolean | null>(null);
  const mask = layer.mask.kind === "pdfPage" ? layer.mask : null;
  const sourceId = mask?.sourceId;
  const page = mask?.page ?? 0;
  const source = sources.find((s) => s.id === sourceId);
  const revision = source?.revision;
  const rotation = mask ? (summaries.get(pageKey(mask))?.rotation.displayed ?? 0) : 0;
  useEffect(() => {
    const session = sourceId && revision !== undefined ? store.session(sourceId, revision) : null;
    if (!session) return;
    let live = true;
    maskAlphaUsable(session, `${sourceId}:${revision}`, page, rotation).then(
      (v) => live && setUsable(v),
      () => live && setUsable(false),
    );
    return () => {
      live = false;
    };
  }, [sourceId, revision, page, store, rotation]);
  return usable;
}

function LayerEditor({ layer }: { layer: FinishLayer }) {
  const [{ model, sources, view }, store] = useProject();
  const summaries = usePageSummaries();
  const alphaUsable = useAlphaUsable(layer);
  const i = layer.interpretation;
  const set = (patch: Partial<typeof i>) => store.setInterpretation(layer.id, patch);
  const target = model.surfaces.find((s) => s.id === layer.target);
  const artFrame = target && frameOf(summaries.get(pageKey(target.artwork))!, target.box);
  const maskSummary = layer.mask.kind === "pdfPage" ? summaries.get(pageKey(layer.mask)) : undefined;
  const maskFrame = target && maskSummary ? frameOf(maskSummary, target.box) : null;
  const warnings = artFrame && maskFrame ? registrationWarnings(artFrame, maskFrame, target!.box) : [];
  const shown = !view.hiddenLayers.includes(layer.id);

  return (
    <div className="layer-editor" data-testid="layer-editor">
      <label>
        Finish
        <select
          data-testid="layer-type"
          value={layer.type}
          onChange={(e) => store.setLayerType(layer.id, e.target.value as FinishType)}
        >
          {FINISH_TYPES.map((t) => (
            <option key={t} value={t}>
              {FINISH_NAMES[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        On printed page
        <select
          data-testid="layer-target"
          value={layer.target ?? ""}
          onChange={(e) => store.assignTarget(layer.id, e.target.value || null)}
        >
          <option value="">Not assigned</option>
          {model.surfaces.map((s) => (
            <option key={s.id} value={s.id}>
              {pageName(sources, summaries, s.artwork)}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          data-testid="layer-enabled"
          checked={layer.enabled}
          onChange={(e) => store.setLayerEnabled(layer.id, e.target.checked)}
        />
        Enabled
      </label>
      <label className="check">
        <input
          type="checkbox"
          data-testid="layer-shown"
          checked={shown}
          onChange={() => store.toggleLayerShown(layer.id)}
        />
        Show in the registration overlay
      </label>

      <label>
        Read the mask by
        <select
          data-testid="mask-mode"
          value={i.mode}
          onChange={(e) => set({ mode: e.target.value as "luminance" | "alpha" })}
        >
          <option value="luminance">Ink (luminance)</option>
          <option value="alpha" disabled={alphaUsable === false}>
            Transparency (alpha)
          </option>
        </select>
      </label>
      <p className="hint" data-testid="alpha-status" data-usable={String(alphaUsable)}>
        {alphaUsable === null
          ? "Checking whether this page has transparency…"
          : alphaUsable
            ? "This page has transparency, so alpha mode is available."
            : "This page is painted edge to edge (its alpha never varies), so alpha mode is not available."}
      </p>
      {i.mode === "luminance" ? (
        <label>
          Finish where the mask is
          <select
            data-testid="mask-polarity"
            value={i.polarity}
            onChange={(e) => set({ polarity: e.target.value as "dark" | "light" })}
          >
            <option value="dark">dark</option>
            <option value="light">light</option>
          </select>
        </label>
      ) : null}
      <label className="check">
        <input
          type="checkbox"
          data-testid="mask-invert"
          checked={i.invert}
          onChange={(e) => set({ invert: e.target.checked })}
        />
        Invert
      </label>
      <label>
        Threshold
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={i.threshold}
          onChange={(e) => set({ threshold: Number(e.target.value) })}
        />
        <NumberField
          testid="mask-threshold"
          value={i.threshold}
          step={0.01}
          min={0}
          max={1}
          onCommit={(v) => set({ threshold: v })}
        />
      </label>
      <label>
        Feather (mm)
        <NumberField
          testid="mask-feather"
          value={i.featherMm}
          step={0.1}
          min={0}
          max={20}
          onCommit={(v) => set({ featherMm: v })}
        />
      </label>
      <div className="offsets">
        <label>
          Shift X (mm, + right)
          <NumberField
            testid="offset-x"
            value={i.offsetMm[0]}
            step={0.1}
            onCommit={(v) => set({ offsetMm: [v, i.offsetMm[1]] })}
          />
        </label>
        <label>
          Shift Y (mm, + up)
          <NumberField
            testid="offset-y"
            value={i.offsetMm[1]}
            step={0.1}
            onCommit={(v) => set({ offsetMm: [i.offsetMm[0], v] })}
          />
        </label>
      </div>
      <div className="row">
        <button
          type="button"
          data-testid="reset-interpretation"
          disabled={JSON.stringify(i) === JSON.stringify(DEFAULT_INTERPRETATION)}
          onClick={() => store.resetInterpretation(layer.id)}
        >
          Reset mask settings
        </button>
        <button type="button" onClick={() => store.moveLayer(layer.id, -1)} aria-label="Move earlier">
          ↑
        </button>
        <button type="button" onClick={() => store.moveLayer(layer.id, 1)} aria-label="Move later">
          ↓
        </button>
        <button type="button" onClick={() => store.removeLayer(layer.id)}>
          Remove finish
        </button>
      </div>
      {warnings.length ? (
        <ul className="diagnostics" data-testid="layer-warnings">
          {warnings.map((w) => (
            <li key={w.code} data-level="warning" data-code={w.code}>
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** How each finish type looks in 3D: one recipe per type, with declared units and limits. */
function FinishLookControls() {
  const [{ model, view }, store] = useProject();
  const field = (
    type: FinishType,
    key: keyof (typeof model.recipes)["uv"],
    label: string,
    step: number,
    min: number,
    max: number,
  ) => (
    <label key={`${type}-${key}`}>
      {label}
      <NumberField
        testid={`recipe-${type}-${key}`}
        value={model.recipes[type][key]}
        step={step}
        min={min}
        max={max}
        onCommit={(v) => store.setRecipe(type, { [key]: v })}
      />
    </label>
  );
  return (
    <details className="details finish-look" data-testid="finish-look">
      <summary>Finish look</summary>
      <p className="hint">{FINISH_NAMES.uv}</p>
      <div className="offsets">
        {field("uv", "gloss", "Gloss (0–1)", 0.05, 0, 1)}
        {field("uv", "strength", "Strength (0–1)", 0.05, 0, 1)}
      </div>
      <p className="hint">{FINISH_NAMES.raisedUv}</p>
      <div className="offsets">
        {field("raisedUv", "gloss", "Gloss (0–1)", 0.05, 0, 1)}
        {field("raisedUv", "strength", "Strength (0–1)", 0.05, 0, 1)}
        {field("raisedUv", "heightUm", "Height (µm)", 5, 10, 300)}
        {field("raisedUv", "bevelMm", "Bevel (mm)", 0.05, 0.05, 2)}
        {field("raisedUv", "crownUm", "Crown (µm)", 5, 0, 100)}
      </div>
      <label>
        Draw raised UV as
        <select
          data-testid="raised-mode"
          value={view.raisedMode}
          onChange={(e) => store.setView({ raisedMode: e.target.value as "normals" | "mesh" })}
        >
          <option value="mesh">Coating geometry</option>
          <option value="normals">Surface normals (lighter, no shadows)</option>
        </select>
      </label>
    </details>
  );
}

export function FinishesSection() {
  const [{ model, sources, view, lastRefusal }, store] = useProject();
  const summaries = usePageSummaries();
  const list = sources.map((s) => ({ id: s.id, pageCount: s.pageCount }));
  const selected = model.layers.find((l) => l.id === view.selectedLayer) ?? null;
  if (!model.layers.length)
    return <p className="hint">Mark a page as Mask to create a finish, and a page as Print to receive it.</p>;
  return (
    <>
      {lastRefusal ? (
        <p
          className="status"
          data-state="failed"
          role="alert"
          data-testid="refusal"
          data-code={lastRefusal.code}
        >
          Not done: {lastRefusal.message}
        </p>
      ) : null}
      <FinishLookControls />
      <ol className="layers">
        {model.layers.map((layer) => {
          const problem = layerProblem(model, layer, list);
          const maskName =
            layer.mask.kind === "pdfPage"
              ? pageName(sources, summaries, layer.mask)
              : layer.mask.declaredKind;
          const target = model.surfaces.find((s) => s.id === layer.target);
          return (
            <li key={layer.id}>
              <button
                type="button"
                className="layer"
                data-testid="layer"
                data-mask={maskName}
                data-problem={problem?.code ?? ""}
                aria-pressed={layer.id === view.selectedLayer}
                onClick={() => store.setView({ selectedLayer: layer.id })}
              >
                <span>
                  <strong>{FINISH_NAMES[layer.type]}</strong>
                  {layer.enabled ? "" : " (off)"}
                </span>
                <span className="muted">
                  mask {maskName} → {target ? pageName(sources, summaries, target.artwork) : "not assigned"}
                </span>
                {problem ? <span className="layer-problem">{problem.message}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
      {selected ? (
        <LayerEditor key={selected.id} layer={selected} />
      ) : (
        <p className="hint">Select a finish to edit it.</p>
      )}
    </>
  );
}

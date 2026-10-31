"use client";

/**
 * View and Stock controls (architecture §2.4): which view the main area
 * shows, which printed pages the leaf or spread uses, camera presets, finish
 * visibility and the print-only comparison; and the paper.
 */
import { pageName, usePageSummaries } from "@/features/document/usePages";
import { STOCK_LIMITS, STOCK_PRESETS, type SceneAssignment, type StockPreset } from "@/project/model";
import { useProject } from "@/project/ProjectContext";
import type { CameraPreset } from "@/rendering/Viewport";

function SlotSelect({ slot, label, empty }: { slot: keyof SceneAssignment; label: string; empty: string }) {
  const [{ model, sources }, store] = useProject();
  const summaries = usePageSummaries();
  return (
    <label>
      {label}
      <select
        data-testid={`slot-${slot}`}
        value={model.scene[slot] ?? ""}
        onChange={(e) => store.setSceneSlot(slot, e.target.value || null)}
      >
        <option value="">{empty}</option>
        {model.surfaces.map((s) => (
          <option key={s.id} value={s.id}>
            {pageName(sources, summaries, s.artwork)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ViewControls({ onCamera }: { onCamera: (kind: CameraPreset) => void }) {
  const [{ view, model, sources }, store] = useProject();
  const summaries = usePageSummaries();
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Main view">
        <button
          type="button"
          role="radio"
          aria-checked={view.mode === "3d"}
          data-testid="view-3d"
          onClick={() => store.setView({ mode: "3d" })}
        >
          3D view
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view.mode === "registration"}
          data-testid="view-registration"
          onClick={() => store.setView({ mode: "registration" })}
        >
          Registration
        </button>
      </div>
      {view.mode === "registration" ? (
        <label>
          Printed page shown
          <select
            data-testid="registration-surface"
            value={view.surfaceId ?? ""}
            onChange={(e) => store.setView({ surfaceId: e.target.value || null })}
          >
            <option value="">Follow the selected finish</option>
            {model.surfaces.map((s) => (
              <option key={s.id} value={s.id}>
                {pageName(sources, summaries, s.artwork)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <div className="segmented" role="radiogroup" aria-label="3D layout">
            <button
              type="button"
              role="radio"
              aria-checked={view.layout === "page"}
              data-testid="layout-page"
              onClick={() => store.setView({ layout: "page" })}
            >
              Page
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={view.layout === "spread"}
              data-testid="layout-spread"
              onClick={() => store.setView({ layout: "spread" })}
            >
              Spread
            </button>
          </div>
          {view.layout === "page" ? (
            <>
              <SlotSelect slot="front" label="Front" empty="Follow the selected page" />
              <SlotSelect slot="back" label="Back" empty="Blank" />
            </>
          ) : (
            <>
              <SlotSelect slot="left" label="Left page" empty="Not chosen" />
              <SlotSelect slot="right" label="Right page" empty="Not chosen" />
            </>
          )}
          <div className="row">
            <button type="button" data-testid="camera-fit" onClick={() => onCamera("fit")}>
              Fit
            </button>
            <button type="button" data-testid="camera-front" onClick={() => onCamera("front")}>
              Front
            </button>
            <button type="button" data-testid="camera-back" onClick={() => onCamera("back")}>
              Back
            </button>
            <button type="button" data-testid="camera-low" onClick={() => onCamera("low")}>
              Low
            </button>
            <button type="button" data-testid="reset-camera" onClick={() => onCamera("reset")}>
              Reset
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              data-testid="show-uv"
              checked={view.show.uv}
              onChange={(e) => store.setView({ show: { ...view.show, uv: e.target.checked } })}
            />
            Show ordinary UV
          </label>
          <label className="check">
            <input
              type="checkbox"
              data-testid="show-raised"
              checked={view.show.raisedUv}
              onChange={(e) => store.setView({ show: { ...view.show, raisedUv: e.target.checked } })}
            />
            Show raised UV
          </label>
          <label className="check">
            <input
              type="checkbox"
              data-testid="print-only"
              checked={view.printOnly}
              onChange={(e) => store.setView({ printOnly: e.target.checked })}
            />
            Print only (compare without finishes)
          </label>
          <p className="hint">Camera: left-drag orbits, right-drag pans, wheel zooms.</p>
        </>
      )}
    </>
  );
}

export function StockControls() {
  const [{ model }, store] = useProject();
  const { stock } = model;
  return (
    <>
      <label>
        Paper
        <select
          data-testid="stock-preset"
          value={stock.preset}
          onChange={(e) => store.setStock({ preset: e.target.value as StockPreset | "custom" })}
        >
          {(Object.entries(STOCK_PRESETS) as [StockPreset, { name: string }][]).map(([id, p]) => (
            <option key={id} value={id}>
              {p.name}
            </option>
          ))}
          <option value="custom" disabled>
            Custom
          </option>
        </select>
      </label>
      <label>
        Roughness
        <input
          type="range"
          min={STOCK_LIMITS.roughness[0]}
          max={STOCK_LIMITS.roughness[1]}
          step={0.01}
          value={stock.roughness}
          onChange={(e) => store.setStock({ roughness: Number(e.target.value) })}
        />
        <output>{stock.roughness.toFixed(2)}</output>
      </label>
      <label>
        Thickness (mm)
        <input
          type="number"
          data-testid="stock-thickness"
          min={STOCK_LIMITS.thicknessMm[0]}
          max={STOCK_LIMITS.thicknessMm[1]}
          step={0.05}
          value={stock.thicknessMm}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v)) store.setStock({ thicknessMm: v });
          }}
        />
      </label>
    </>
  );
}

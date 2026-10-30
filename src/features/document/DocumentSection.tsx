"use client";

/**
 * Document: opening, source identity, readers, diagnostics, and document
 * details read only on request. Every state reads differently on screen:
 * waiting, cancelled, loading, password needed, wrong password, failed, open.
 */
import { useState, type FormEvent } from "react";
import type { Capability } from "@/project/capability";
import { useProject } from "@/project/ProjectContext";
import type { LoadState } from "@/project/store";
import { bytesText } from "./format";

function statusText(load: LoadState, pages?: number) {
  switch (load.kind) {
    case "idle":
      return "No document open.";
    case "selecting":
      return "Waiting for a file to be chosen…";
    case "cancelled":
      return load.kept
        ? "Selection cancelled; the open document is unchanged."
        : "Cancelled; nothing was opened.";
    case "loading":
      return load.step === "reading" ? `Reading ${load.name}…` : `Opening ${load.name}…`;
    case "password":
      return load.attempt === "wrong"
        ? `That password does not open ${load.name}. Try again.`
        : `${load.name} needs a password to open.`;
    case "failed":
      return `Could not open${load.name ? ` ${load.name}` : ""} (${load.code}): ${load.message}`;
    case "ready":
      return `Open: ${pages} page${pages === 1 ? "" : "s"}.`;
  }
}

/** One line for a capability that is not (yet) a value. */
export function CapabilityText({
  cap,
  absent = "not present in the file",
}: {
  cap: Capability<unknown>;
  absent?: string;
}) {
  const text =
    cap.status === "notRequested"
      ? "not inspected yet"
      : cap.status === "running"
        ? "reading…"
        : cap.status === "absent"
          ? absent
          : cap.status === "unsupported"
            ? `not supported: ${cap.reason}`
            : cap.status === "failed"
              ? `failed (${cap.code}): ${cap.message}`
              : "";
  return (
    <span className="cap" data-status={cap.status}>
      {text}
    </span>
  );
}

function PasswordForm({ attempt }: { attempt: "needed" | "wrong" }) {
  const [, store] = useProject();
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const password = value;
    setValue("");
    void store.submitPassword(password);
  };
  return (
    <form className="password" onSubmit={submit} data-attempt={attempt}>
      <label>
        Password
        <input
          type="password"
          autoComplete="off"
          data-testid="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
      </label>
      <div className="row">
        <button type="submit" data-testid="password-submit">
          Open
        </button>
        <button type="button" onClick={() => store.cancelPassword()}>
          Cancel
        </button>
      </div>
      <p className="hint">Used only to open this file now; it is not saved.</p>
    </form>
  );
}

export function DocumentSection() {
  const [{ load, source }, store] = useProject();
  const digest = source?.digest;
  const geometry = source?.geometry;
  return (
    <>
      <div className="row">
        <button
          type="button"
          data-testid="open-pdf"
          onClick={() => void store.open()}
          disabled={load.kind === "selecting"}
        >
          Open PDF…
        </button>
        {load.kind === "loading" ? (
          <button type="button" data-testid="cancel-open" onClick={() => store.cancelLoad()}>
            Cancel
          </button>
        ) : null}
      </div>
      <p className="status" data-testid="doc-status" data-state={load.kind}>
        {statusText(load, source?.pageCount)}
      </p>
      {load.kind === "password" ? <PasswordForm attempt={load.attempt} /> : null}

      {source ? (
        <>
          <dl className="facts" data-testid="source-identity">
            <dt>File</dt>
            <dd>{source.name}</dd>
            <dt>Size</dt>
            <dd>
              {bytesText(source.size)} ({source.size} bytes)
            </dd>
            <dt>SHA-256</dt>
            <dd data-testid="digest" title={digest?.status === "available" ? digest.value : undefined}>
              {digest?.status === "available" ? (
                `${digest.value.slice(0, 16)}…`
              ) : (
                <CapabilityText cap={digest!} />
              )}
            </dd>
            <dt>Pages</dt>
            <dd data-testid="page-count">{source.pageCount}</dd>
            <dt>Rendering</dt>
            <dd>{source.engine}</dd>
            <dt>Page boxes</dt>
            <dd data-testid="geometry-status" data-status={geometry?.status}>
              {geometry?.status === "available" ? geometry.value.engine : <CapabilityText cap={geometry!} />}
            </dd>
          </dl>

          {source.diagnostics.length ? (
            <ul className="diagnostics" data-testid="diagnostics">
              {source.diagnostics.map((d) => (
                <li key={`${d.code}-${d.page ?? ""}`} data-level={d.level} data-code={d.code}>
                  <strong>
                    {d.level === "limitation" ? "Limitation" : d.level === "error" ? "Problem" : "Warning"}:
                  </strong>{" "}
                  {d.message}
                </li>
              ))}
            </ul>
          ) : null}

          <details
            className="details"
            data-testid="doc-details"
            onToggle={(e) => {
              if ((e.currentTarget as HTMLDetailsElement).open) store.requestMetadata();
            }}
          >
            <summary>Document details</summary>
            <DocumentDetails />
          </details>
        </>
      ) : null}
    </>
  );
}

function DocumentDetails() {
  const [{ source }] = useProject();
  const meta = source?.metadata;
  if (!meta) return null;
  if (meta.status !== "available")
    return (
      <p className="hint" data-testid="metadata-status" data-status={meta.status}>
        <CapabilityText cap={meta} />
      </p>
    );
  const m = meta.value;
  return (
    <dl className="facts" data-testid="metadata" data-status="available">
      {m.fields.map((f) => (
        <div key={f.key} className="fact" data-field={f.key} data-absent={f.value === null}>
          <dt>{f.label}</dt>
          <dd>
            {f.value ?? (
              <span className="cap" data-status="absent">
                not stated
              </span>
            )}
          </dd>
        </div>
      ))}
      <dt>PDF version</dt>
      <dd>
        {m.pdfVersion ?? (
          <span className="cap" data-status="absent">
            not stated
          </span>
        )}
      </dd>
      <dt>Encryption</dt>
      <dd>{m.encryption ?? "none"}</dd>
      <dt>Permissions</dt>
      <dd data-testid="permissions">
        {m.permissions === null
          ? "no restrictions declared"
          : `allowed by the file: ${m.permissions.join(", ") || "none"} (reported, not enforced)`}
      </dd>
      <dt>XMP metadata</dt>
      <dd data-testid="xmp">
        {m.xmp === "present" ? (
          <span className="cap" data-status="unsupported">
            present; not read in this version
          </span>
        ) : (
          <span className="cap" data-status="absent">
            not present in the file
          </span>
        )}
      </dd>
      <dt>Read by</dt>
      <dd>{meta.provenance.engine}</dd>
    </dl>
  );
}

import { useEffect, useState } from "react";
import type {
  DesktopMemorySnapshot,
  DesktopRequest,
  DesktopSnapshot,
} from "@loadstone/application";
import type { Fact, FactKind, FactValue, Receipt } from "@loadstone/application";

type Request = (request: DesktopRequest) => Promise<boolean>;
const display = (value: FactValue | undefined) =>
  value === undefined ? "Not saved (unknown)" : JSON.stringify(value);

function ReceiptCard({
  receipt,
  busy,
  request,
}: {
  receipt: Receipt;
  busy: boolean;
  request: Request;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <article className="fact">
      <strong>{receipt.status === "review" ? "Needs your review" : receipt.status}</strong>
      <small>
        Operation: {receipt.id}
        {receipt.undoOf ? ` · Undoes ${receipt.undoOf}` : ""}
      </small>
      {receipt.conflicts.map((conflict) => (
        <p key={conflict}>{conflict}</p>
      ))}
      {receipt.changes.map((change) => (
        <details key={`${change.kind}:${change.key}`}>
          <summary>
            {change.kind} / {change.key}
          </summary>
          <p>Before: {display(change.before?.value)}</p>
          <p>After: {display(change.after?.value)}</p>
          {[change.before, change.after].map(
            (fact, index) =>
              fact && (
                <p key={index} className="muted">
                  {index === 0 ? "Before" : "After"} source: {fact.source} · observed{" "}
                  {new Date(fact.observedAt).toLocaleString()}
                  <br />
                  {fact.evidence}
                </p>
              ),
          )}
        </details>
      ))}
      {receipt.status === "review" && (
        <div className="actions">
          <button
            disabled={busy}
            onClick={() => void request({ type: "review", id: receipt.id, accept: true })}
          >
            Approve update
          </button>
          <button
            disabled={busy}
            onClick={() => void request({ type: "review", id: receipt.id, accept: false })}
          >
            Reject update
          </button>
        </div>
      )}
      {receipt.status === "saved" &&
        (confirm ? (
          <div>
            <p>Undo this entire operation? Newer changes to these facts will block undo.</p>
            <button
              disabled={busy}
              onClick={() =>
                void request({ type: "undo", id: receipt.id }).then((ok) => {
                  if (ok) setConfirm(false);
                })
              }
            >
              Confirm undo
            </button>{" "}
            <button onClick={() => setConfirm(false)}>Keep update</button>
          </div>
        ) : (
          <button disabled={busy} onClick={() => setConfirm(true)}>
            Undo update…
          </button>
        ))}
    </article>
  );
}

function FactEditor({
  fact,
  busy,
  request,
  done,
}: {
  fact: Fact;
  busy: boolean;
  request: Request;
  done: () => void;
}) {
  const [value, setValue] = useState(JSON.stringify(fact.value));
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const parsed: unknown = JSON.parse(value);
          // The backend validates the kind-specific value; this form sends no command string.
          void request({
            type: "edit",
            change: { kind: fact.kind, key: fact.key, value: parsed as FactValue },
          }).then((ok) => {
            if (ok) done();
          });
          setError("");
        } catch {
          setError("Enter valid JSON: numbers, true/false, or quoted text.");
        }
      }}
    >
      <label>
        Correct {fact.key} (JSON value)
        <textarea
          value={value}
          maxLength={16000}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <p className="muted">
        Skills: 1–120. Quests: "COMPLETED", "STARTED", "NOT_STARTED". Goals: "active", "paused",
        "completed". Deletions and lost progress require review.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button disabled={busy}>Save correction</button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void request({
              type: "edit",
              change: { kind: fact.kind, key: fact.key, value: null },
            }).then((ok) => {
              if (ok) done();
            })
          }
        >
          Propose deletion
        </button>
        <button type="button" onClick={done}>
          Cancel edit
        </button>
      </div>
    </form>
  );
}

export function PlayerControls({
  state,
  busy,
  request,
}: {
  state: DesktopSnapshot;
  busy: boolean;
  request: Request;
}) {
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Fact>();
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<FactKind | "">("");
  const [memory, setMemory] = useState<DesktopMemorySnapshot>();
  const [memoryError, setMemoryError] = useState(false);
  const characterId = state.character?.id;
  const memoryRevision = state.memoryRevision;
  useEffect(() => {
    if (!characterId) return;
    let active = true;
    setMemoryError(false);
    void window.loadstone
      .memory()
      .then((result) => {
        if (active && result.characterId === characterId) setMemory(result);
      })
      .catch(() => {
        if (active) setMemoryError(true);
      });
    return () => {
      active = false;
    };
  }, [characterId, memoryRevision]);
  const reviews = memory?.reviews ?? [];
  const auditBusy = busy || memory?.revision !== memoryRevision;
  return (
    <>
      {memoryError && <p role="alert">Could not load goals or memory history.</p>}
      <details>
        <summary>Conversations ({state.sessions?.length ?? 0})</summary>
        <label>
          Find conversation
          <input value={filter} onChange={(event) => setFilter(event.target.value)} />
        </label>
        {(state.sessions ?? [])
          .filter((session) =>
            `${session.title} ${session.id}`.toLowerCase().includes(filter.toLowerCase()),
          )
          .map((session) => (
            <article className="fact" key={session.id}>
              <strong>{session.title || "Untitled conversation"}</strong>
              <small>{new Date(session.createdAt).toLocaleString()}</small>
              <button
                disabled={busy || session.id === state.session?.id}
                onClick={() => void request({ type: "resume", id: session.id })}
              >
                {session.id === state.session?.id ? "Current conversation" : "Resume conversation"}
              </button>
            </article>
          ))}
      </details>
      <details>
        <summary>Goals and plans</summary>
        <pre className="goals">
          {memory?.goals ??
            (characterId && !memoryError ? "Loading goals…" : "No saved goals yet.")}
        </pre>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void request({ type: "plan", target }).then((ok) => {
              if (ok) setTarget("");
            });
          }}
        >
          <label>
            Research a plan
            <input
              value={target}
              maxLength={100}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="e.g. Prifddinas"
            />
          </label>
          <p className="muted">
            Sends your target and character context to the selected AI provider. Plans may save
            automatically.
          </p>
          <button
            disabled={
              busy || !state.character || !target.trim() || state.connection?.mode === "offline"
            }
          >
            Research plan
          </button>
        </form>
      </details>
      <details open>
        <summary>Saved memory ({state.facts.length})</summary>
        <p className="muted">
          Clear reports save automatically. Conflicts and deletions need approval below. Unknown is
          not false; items are last reported, not a live bank.
        </p>
        <label>
          Memory type
          <select value={kind} onChange={(event) => setKind(event.target.value as FactKind | "")}>
            <option value="">All types</option>
            {[...new Set(state.facts.map((fact) => fact.kind))].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {state.facts.length === 0 && (
          <p>No saved facts. Sync RuneMetrics or report progress in chat.</p>
        )}
        {state.facts
          .filter((fact) => !kind || fact.kind === kind)
          .map((fact) => (
            <article className="fact" key={`${fact.kind}:${fact.key}`}>
              <strong>{fact.key}</strong> <span>{display(fact.value)}</span>
              <small>
                {fact.kind} · {fact.source} · observed {new Date(fact.observedAt).toLocaleString()}
              </small>
              <small>{fact.evidence}</small>
              <button disabled={busy} onClick={() => setEditing(fact)}>
                Correct {fact.key}
              </button>
              {editing?.kind === fact.kind && editing.key === fact.key && (
                <FactEditor
                  key={fact.operationId}
                  fact={fact}
                  busy={busy}
                  request={request}
                  done={() => setEditing(undefined)}
                />
              )}
            </article>
          ))}
      </details>
      <details open={reviews.length > 0}>
        <summary>Memory review ({state.pending})</summary>
        <p>
          Review the entire operation before approving. Approval applies every change together.
          Rejecting leaves saved memory unchanged.
        </p>
        {reviews.map((receipt) => (
          <ReceiptCard key={receipt.id} receipt={receipt} busy={auditBusy} request={request} />
        ))}
      </details>
      <details>
        <summary>Memory history</summary>
        <p>
          Latest 100 operations, including automatic saves, corrections and undo. Export includes
          the full history.
        </p>
        {memory?.history
          .filter((receipt) => receipt.status !== "review")
          .map((receipt) => (
            <ReceiptCard key={receipt.id} receipt={receipt} busy={auditBusy} request={request} />
          ))}
      </details>
      <details>
        <summary>Export and backup</summary>
        <p>
          Exports contain this character’s facts, provenance and full memory history (not chat).
          Backups contain all characters and conversations. Both contain private data, not provider
          credentials. Files are saved inside your Loadstone data folder; the resulting path appears
          in Status.
        </p>
        <div className="actions">
          <button
            disabled={busy || !state.character}
            onClick={() => void request({ type: "export" })}
          >
            Export character JSON
          </button>
          <button
            disabled={busy || !state.character}
            onClick={() => void request({ type: "backup" })}
          >
            Back up all characters and chats
          </button>
        </div>
        <p>
          Restore and data-folder migration are not available in this preview. Keep backups intact;
          see the desktop guide for offline recovery.
        </p>
      </details>
    </>
  );
}

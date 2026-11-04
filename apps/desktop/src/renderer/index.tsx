import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DesktopAPI, DesktopRequest, DesktopSnapshot } from "@loadstone/application";
import "./style.css";

declare global {
  interface Window {
    loadstone: DesktopAPI;
  }
}

function App() {
  const [state, setState] = useState<DesktopSnapshot>();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const chat = useRef<HTMLElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    let active = true;
    let updated = false;
    const unsubscribe = window.loadstone.subscribe((snapshot) => {
      updated = true;
      if (active) setState(snapshot);
    });
    void window.loadstone
      .snapshot()
      .then((snapshot) => {
        if (active && !updated) setState(snapshot);
      })
      .catch(() => setError("Could not connect to Loadstone storage. Restart the app."));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (follow.current && chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [state?.view]);
  const request = async (value: DesktopRequest) => {
    setError("");
    setSubmitting(true);
    try {
      await window.loadstone.request(value);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed.");
      return false;
    } finally {
      setSubmitting(false);
    }
  };
  if (!state)
    return (
      <main>
        <h1>Loadstone</h1>
        <p role="status">{error || "Opening local memory…"}</p>
      </main>
    );
  const busy = state.processing || state.view.busy || submitting;
  return (
    <main className="layout">
      <aside>
        <h1>
          Loadstone <small>Desktop preview</small>
        </h1>
        <p className="muted">Your local-first Ironman companion</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void request({ type: "character", name });
          }}
        >
          <label htmlFor="rsn">RuneScape name</label>
          <input
            id="rsn"
            value={name}
            maxLength={12}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your RSN"
          />
          <button disabled={busy || !name.trim()}>Open character</button>
        </form>
        {state.characters.length > 0 && (
          <label>
            Saved characters
            <select
              aria-label="Saved characters"
              value={state.character?.name ?? ""}
              disabled={busy}
              onChange={(event) => void request({ type: "character", name: event.target.value })}
            >
              <option value="" disabled>
                Select a character
              </option>
              {state.characters.map((character) => (
                <option key={character.id}>{character.name}</option>
              ))}
            </select>
          </label>
        )}
        <h2>{state.character?.name ?? "No character selected"}</h2>
        <p>{state.character?.mode}</p>
        <div className="actions">
          <button
            disabled={busy || !state.character}
            onClick={() => void request({ type: "sync" })}
          >
            Sync RuneMetrics
          </button>
          <button
            disabled={busy || !state.character}
            onClick={() => void request({ type: "newSession" })}
          >
            New conversation
          </button>
        </div>
        <details>
          <summary>Connection settings</summary>
          <p>
            This preview reuses existing pi credentials or provider environment keys. Guided login
            comes next.
          </p>
          <button disabled={busy} onClick={() => void request({ type: "auth" })}>
            Show credential status
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void request({ type: "model", provider, modelId });
            }}
          >
            <label htmlFor="provider">Provider</label>
            <input
              id="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="openai"
            />
            <label htmlFor="model">Model ID</label>
            <input
              id="model"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            />
            <button disabled={busy || !state.character || !provider || !modelId}>Use model</button>
          </form>
        </details>
        <details open>
          <summary>Saved memory ({state.facts.length})</summary>
          <p className="muted">Last reported facts, not a live bank or game feed.</p>
          {state.facts.length === 0 && (
            <p>No saved facts yet. Sync or report your progress in chat.</p>
          )}
          {state.facts.map((fact) => (
            <article className="fact" key={`${fact.kind}:${fact.key}`}>
              <strong>{fact.key}</strong>{" "}
              <span>
                {typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)}
              </span>
              <small>
                {fact.kind} · {fact.source} · {new Date(fact.observedAt).toLocaleDateString()}
              </small>
              <small>{fact.evidence}</small>
            </article>
          ))}
        </details>
      </aside>
      <section className="conversation">
        <header>
          <h2>Conversation</h2>
          <small>
            {state.view.model
              ? `${state.view.model.provider} / ${state.view.model.modelId}`
              : "No active model"}
          </small>
        </header>
        <section
          className="chat"
          ref={chat}
          aria-label="Conversation messages"
          onScroll={() => {
            const element = chat.current!;
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
          }}
        >
          {state.view.hasEarlier && (
            <button disabled={busy} onClick={() => void request({ type: "earlier" })}>
              Load earlier messages
            </button>
          )}
          {state.view.messages.length === 0 && (
            <p className="muted">
              Ask about a goal or tell Loadstone what you have achieved. Clear progress can be saved
              automatically.
            </p>
          )}
          {state.view.messages.map((message) => (
            <article className={`message ${message.role.toLowerCase()}`} key={message.id}>
              <strong>{message.role}</strong>
              <Markdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                  a: ({ children, href }) => (
                    <span title={href}>
                      {children} {href && <small>({href})</small>}
                    </span>
                  ),
                  img: () => null,
                }}
              >
                {message.text}
              </Markdown>
            </article>
          ))}
          {state.view.partial && (
            <article className="message assistant">
              <strong>Assistant · responding</strong>
              <p className="partial">{state.view.partial}</p>
            </article>
          )}
        </section>
        <section className="status" aria-label="Status">
          {state.notice && <p>{state.notice}</p>}
          {state.view.activity.map((activity) => (
            <p key={activity}>{activity}</p>
          ))}
          {(error || state.view.failure) && <p role="alert">{error || state.view.failure}</p>}
        </section>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            follow.current = true;
            const submitted = draft;
            void request({ type: "send", text: submitted }).then((accepted) => {
              if (accepted) setDraft((current) => (current === submitted ? "" : current));
            });
          }}
        >
          <label htmlFor="message">Message</label>
          <textarea
            id="message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={32000}
            rows={3}
            placeholder="Ask for advice or report progress…"
            disabled={!state.character}
          />
          <div className="actions">
            <button disabled={busy || !state.character || !draft.trim()}>Send</button>
            <button type="button" disabled={!busy} onClick={() => void request({ type: "cancel" })}>
              Cancel work
            </button>
          </div>
        </form>
        <footer>
          Memory stays on this machine. Chat and retrieved context go to your model provider. Never
          enter passwords or API keys in chat.
        </footer>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

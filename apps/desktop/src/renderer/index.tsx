import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DesktopAPI, DesktopRequest, DesktopSnapshot } from "@loadstone/application";
import "./style.css";
import { PlayerControls } from "./player-controls";

declare global {
  interface Window {
    loadstone: DesktopAPI;
  }
}

function App() {
  const [state, setState] = useState<DesktopSnapshot>();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"ironman" | "hardcore" | "group-ironman">("ironman");
  const [scale, setScale] = useState(100);
  const anchor = useRef<{ height: number; top: number; first?: string } | undefined>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState("");
  const [answer, setAnswer] = useState("");
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
    setAnswer("");
  }, [state?.connection?.prompt?.id]);
  useEffect(() => {
    anchor.current = undefined;
    follow.current = true;
  }, [state?.session?.id]);
  useEffect(() => {
    const element = chat.current;
    if (!element) return;
    if (anchor.current) {
      if (anchor.current.first !== state?.view.messages[0]?.id) {
        element.scrollTop = anchor.current.top + element.scrollHeight - anchor.current.height;
        anchor.current = undefined;
      } else if (!state?.processing && !submitting) {
        // No older rows were returned; do not leave a stale anchor behind.
        anchor.current = undefined;
      }
    } else if (follow.current) element.scrollTop = element.scrollHeight;
  }, [state?.view, state?.processing, submitting]);
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
  const connection = state.connection;
  const sessionId = state.session?.id;
  const draft = sessionId ? (drafts[sessionId] ?? "") : "";
  return (
    <main className="layout" style={{ fontSize: `${scale}%` }}>
      <a className="skip-link" href="#message">
        Skip to message
      </a>
      <aside>
        <h1>
          Loadstone <small>Desktop preview</small>
        </h1>
        <p className="muted">Your local-first Ironman companion</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void request({ type: "character", name, mode });
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
          <label>
            New character mode
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
              disabled={busy}
            >
              <option value="ironman">Ironman</option>
              <option value="hardcore">Hardcore Ironman</option>
              <option value="group-ironman">Group Ironman</option>
            </select>
          </label>
          <p className="muted">Existing characters keep their saved mode.</p>
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
        <details open>
          <summary>Connect AI / first-run setup</summary>
          <p>
            Create your Ironman above, sync RuneMetrics, then connect AI to chat. You can also
            continue without AI.
          </p>
          <p>
            Private credentials are encrypted for your OS account. Shared pi login reads and may
            refresh/write pi’s original credential file. Disconnect removes credentials from the
            selected store, not your provider account.
          </p>
          <label>
            Credential storage
            <select
              aria-label="Credential storage"
              value={connection?.mode ?? "offline"}
              disabled={busy || connection?.busy}
              onChange={(event) =>
                void request({
                  type: "connection",
                  mode: event.target.value as "private" | "shared" | "offline",
                })
              }
            >
              <option value="offline">Continue without AI</option>
              <option value="private">Private Loadstone credentials (recommended)</option>
              <option value="shared">Use shared pi login (allows refresh writes)</option>
            </select>
          </label>
          <p role="status">{connection?.message}</p>
          {connection?.mode !== "offline" && (
            <>
              <label>
                Provider
                <select
                  aria-label="Provider"
                  value={provider}
                  disabled={busy || connection?.busy}
                  onChange={(event) => setProvider(event.target.value)}
                >
                  <option value="">Choose a provider</option>
                  {connection?.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.connected ? " · connected" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Use an account authorized for this application. Browser login availability does not
                guarantee subscription eligibility. API usage may incur charges.
              </p>
              <div className="actions">
                <button
                  disabled={
                    busy ||
                    connection?.busy ||
                    !connection?.providers.find((p) => p.id === provider)?.apiKey
                  }
                  onClick={() => void request({ type: "login", provider, method: "api_key" })}
                >
                  Connect API key
                </button>
                <button
                  disabled={
                    busy ||
                    connection?.busy ||
                    !connection?.providers.find((p) => p.id === provider)?.oauth
                  }
                  onClick={() => void request({ type: "login", provider, method: "oauth" })}
                >
                  Browser login
                </button>
                <button
                  disabled={
                    busy ||
                    connection?.busy ||
                    !connection?.providers.find((p) => p.id === provider)?.connected
                  }
                  onClick={() => void request({ type: "logout", provider })}
                >
                  Disconnect
                </button>
              </div>
              {connection?.link && (
                <p className="login-link">Login URL (if browser did not open): {connection.link}</p>
              )}
              {connection?.prompt && (
                <form
                  key={connection.prompt.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = answer;
                    setAnswer("");
                    void request({ type: "answerLogin", id: connection.prompt!.id, value });
                  }}
                >
                  <label htmlFor="login-answer">{connection.prompt.message}</label>
                  {connection.prompt.options ? (
                    <select
                      id="login-answer"
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                    >
                      <option value="">Choose…</option>
                      {connection.prompt.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="login-answer"
                      type="password"
                      autoComplete="off"
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      maxLength={16000}
                    />
                  )}
                  <button disabled={!answer}>Continue login</button>
                </form>
              )}
              {connection?.busy && (
                <button onClick={() => void request({ type: "cancelLogin" })}>Cancel login</button>
              )}
              <label>
                Account-compatible model
                <select
                  aria-label="Account-compatible model"
                  value={
                    state.view.model
                      ? `${state.view.model.provider}/${state.view.model.modelId}`
                      : ""
                  }
                  disabled={busy || connection?.busy || !state.character}
                  onChange={(event) => {
                    const model = connection?.models.find(
                      (m) => `${m.provider}/${m.id}` === event.target.value,
                    );
                    if (model)
                      void request({ type: "model", provider: model.provider, modelId: model.id });
                  }}
                >
                  <option value="">Choose a model after opening a character</option>
                  {connection?.models.map((m) => (
                    <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                      {m.provider} / {m.name} · ${m.input} in / ${m.output} out per 1M tokens
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </details>
        <label>
          Text size
          <select value={scale} onChange={(event) => setScale(Number(event.target.value))}>
            <option value={100}>100%</option>
            <option value={125}>125%</option>
            <option value={150}>150%</option>
          </select>
        </label>
        <PlayerControls
          key={state.character?.id ?? "none"}
          state={state}
          busy={busy}
          request={request}
        />
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
            <button
              disabled={busy}
              onClick={() => {
                if (chat.current)
                  anchor.current = {
                    height: chat.current.scrollHeight,
                    top: chat.current.scrollTop,
                    first: state.view.messages[0]?.id,
                  };
                follow.current = false;
                void request({ type: "earlier" }).then((ok) => {
                  if (!ok) anchor.current = undefined;
                });
              }}
            >
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
              <button
                className="copy"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(message.text)
                    .catch(() =>
                      setError("Could not copy message. Select the text and copy manually."),
                    )
                }
              >
                Copy message
              </button>
              <Markdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                  a: ({ children, href }) => (
                    <span title={href}>
                      {children} {href && <small>({href})</small>}
                      {href?.startsWith("https://runescape.wiki/") && (
                        <button onClick={() => void request({ type: "openWiki", url: href })}>
                          Open wiki in browser…
                        </button>
                      )}
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
        <section className="status" aria-label="Status" aria-live="polite" aria-atomic="false">
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
            if (!sessionId || !draft.trim() || busy) return;
            follow.current = true;
            void request({ type: "send", text: draft }).then((accepted) => {
              if (!accepted) return;
              setDrafts((current) => {
                if (current[sessionId] !== draft) return current;
                const next = { ...current };
                delete next[sessionId];
                return next;
              });
            });
          }}
        >
          <label htmlFor="message">Message</label>
          <textarea
            id="message"
            value={draft}
            onChange={(event) => {
              if (!sessionId) return;
              const value = event.target.value;
              setDrafts((current) => ({ ...current, [sessionId]: value }));
            }}
            maxLength={32000}
            rows={3}
            placeholder="Ask for advice or report progress…"
            disabled={!sessionId}
          />
          <div className="actions">
            <button disabled={busy || !sessionId || !draft.trim()}>Send</button>
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

import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw, X, Info } from "lucide-react";
import { api, type Challenge, type Token } from "./api";

export type Status =
  "idle" | "loading" | "challenge" | "verified" | "expired" | "error";
type Props = {
  sitekey: string;
  action: string;
  origin: string;
  session: string;
  resetKey: number;
  embedded?: boolean;
  consumed?: boolean;
  onToken: (token: Token | null) => void;
  onStatus: (status: Status) => void;
  onError?: (message: string) => void;
};

export function Captcha({
  sitekey,
  action,
  origin,
  session,
  resetKey,
  embedded,
  consumed = false,
  onToken,
  onStatus,
  onError,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    setStatus("idle");
    setChallenge(null);
    setSelected([]);
    setError("");
    setExpiresAt(0);
    setBusy(false);
    onToken(null);
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [resetKey, sitekey, action, origin, session, onToken]);
  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);
  useEffect(() => {
    if (status === "challenge" && !embedded && !dialog.current?.open)
      dialog.current?.showModal();
    else if (status !== "challenge") dialog.current?.close();
  }, [status, embedded]);
  useEffect(() => {
    if (consumed || !expiresAt || !["verified", "challenge"].includes(status))
      return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) {
        generation.current++;
        controller.current?.abort();
        setBusy(false);
        setStatus("expired");
        setError("Verification expired. Please try again.");
        onToken(null);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, status, onToken, consumed]);

  async function start() {
    const current = ++generation.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setStatus("loading");
    setError("");
    setBusy(true);
    setSelected([]);
    setImageFailed(false);
    onToken(null);
    try {
      const result = await api<Challenge>(
        "/v1/challenges",
        { sitekey, action, origin, session },
        controller.current.signal,
      );
      if (current !== generation.current) return;
      setChallenge(result);
      setExpiresAt(result.expiresAt);
      setStatus("challenge");
    } catch (e) {
      if (current !== generation.current) return;
      const message =
        e instanceof Error ? e.message : "Could not load the challenge.";
      setError(message);
      setStatus("error");
      onError?.(message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function solve() {
    if (!challenge || !selected.length) return;
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ token: string; expiresAt: number }>(
        `/v1/challenges/${challenge.id}/solve`,
        { selected, session },
        controller.current?.signal,
      );
      if (current !== generation.current) return;
      setExpiresAt(result.expiresAt);
      setStatus("verified");
      onToken({ value: result.token, expiresAt: result.expiresAt });
    } catch (e) {
      if (current === generation.current) {
        const message = e instanceof Error ? e.message : "Verification failed.";
        setError(message);
        onError?.(message);
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  const cancel = () => {
    generation.current++;
    controller.current?.abort();
    setBusy(false);
    setStatus("idle");
    setError("");
    onToken(null);
  };
  const challengeContent = (
    <>
      <div className="challenge-heading">
        <div>
          <span>Select all images with</span>
          <h2 id="challenge-title">{challenge?.target}</h2>
          <small>Click verify when you are done.</small>
        </div>
        <button
          className="icon-button close-challenge"
          aria-label="Close challenge"
          onClick={cancel}
        >
          <X size={20} />
        </button>
      </div>
      <div className="image-grid" aria-label={challenge?.prompt}>
        {challenge?.tiles.map((tile, i) => (
          <button
            key={tile.id}
            type="button"
            aria-label={`Image ${i + 1}`}
            aria-pressed={selected.includes(tile.id)}
            disabled={busy}
            className={selected.includes(tile.id) ? "selected" : ""}
            onClick={() =>
              setSelected((current) =>
                current.includes(tile.id)
                  ? current.filter((id) => id !== tile.id)
                  : [...current, tile.id],
              )
            }
          >
            <img
              src={tile.url}
              alt={`Image option ${i + 1}`}
              onError={() => setImageFailed(true)}
            />
            {selected.includes(tile.id) && (
              <span className="selection-check">
                <Check size={16} />
              </span>
            )}
          </button>
        ))}
      </div>
      {(error || imageFailed) && (
        <p className="challenge-error" role="alert">
          {imageFailed
            ? "Images could not load. Start a new challenge."
            : error}
        </p>
      )}
      <div className="challenge-controls">
        <button
          type="button"
          className="icon-button"
          title="Load a new challenge"
          aria-label="Load a new challenge"
          disabled={busy}
          onClick={start}
        >
          <RefreshCw size={20} />
        </button>
        <span>
          {seconds} sec · {selected.length} selected
        </span>
        <button
          type="button"
          className="verify-button"
          onClick={solve}
          disabled={busy || !selected.length || imageFailed}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : null}Verify
        </button>
      </div>
      <p className="keyboard-hint">
        <Info size={12} /> Use Tab and Space to select images.
      </p>
    </>
  );
  return (
    <div className={`captcha-wrap ${embedded ? "embedded" : ""}`}>
      <button
        type="button"
        className={`captcha-checkbox ${status === "verified" ? "is-verified" : ""}`}
        onClick={start}
        disabled={busy || status === "verified" || status === "challenge"}
        aria-label={
          status === "verified"
            ? "Verification complete"
            : "I am not a robot, start verification"
        }
      >
        <span className={`checkbox-square ${status}`}>
          {status === "verified" ? (
            <Check size={28} />
          ) : status === "loading" ? (
            <LoaderCircle className="spin" size={23} />
          ) : null}
        </span>
        <span className="captcha-label">
          {status === "verified"
            ? "Verified"
            : status === "loading"
              ? "Checking…"
              : "I am not a robot"}
        </span>
        <span className="captcha-brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <strong>ZETTHER</strong>
          <small>reCAPTCHA Fake</small>
        </span>
      </button>
      {status === "verified" && (
        <p className="captcha-caption success-text">
          <Check size={12} />{" "}
          {consumed
            ? "Verification used. Reset to try again."
            : `Token active · ${seconds} seconds left`}
        </p>
      )}
      {["expired", "error"].includes(status) && (
        <p className="captcha-caption error-text" role="alert">
          {error}
        </p>
      )}
      {embedded ? (
        status === "challenge" && (
          <section
            className="challenge-panel embedded-challenge"
            role="group"
            aria-labelledby="challenge-title"
          >
            {challengeContent}
          </section>
        )
      ) : (
        <dialog
          className="challenge-panel"
          ref={dialog}
          aria-labelledby="challenge-title"
          onCancel={(event) => {
            event.preventDefault();
            cancel();
          }}
        >
          {challengeContent}
        </dialog>
      )}
    </div>
  );
}

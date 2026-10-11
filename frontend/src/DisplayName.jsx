import { useState } from "react";
import { updateProfile } from "firebase/auth";

// Lets the user choose the name shown next to their results.
// Only this name is shown to other people, never the email address.
export default function DisplayName({ user }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e) {
    e.preventDefault();
    const clean = draft.trim().slice(0, 40);
    if (!clean) return;
    setBusy(true);
    setError("");
    try {
      await updateProfile(user, { displayName: clean });
      // Refresh the login token so new submissions carry the new name.
      await user.getIdToken(true);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form className="name-form" onSubmit={save}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Display name"
          maxLength={40}
          aria-label="Display name"
          autoFocus
        />
        <button type="submit" disabled={busy}>Save</button>
        <button type="button" className="ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {error && <span className="error">{error}</span>}
      </form>
    );
  }

  return (
    <span>
      {user.displayName ? (
        <>Shown as <strong>{user.displayName}</strong></>
      ) : (
        <span className="muted">No display name set</span>
      )}{" "}
      <button
        className="ghost"
        onClick={() => {
          setDraft(user.displayName || "");
          setEditing(true);
        }}
      >
        {user.displayName ? "Change" : "Set name"}
      </button>
    </span>
  );
}

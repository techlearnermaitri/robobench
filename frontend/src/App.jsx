import { useEffect, useState } from "react";
import { onIdTokenChanged, signOut } from "firebase/auth";
import { auth } from "./firebase";
import AuthPage from "./AuthPage.jsx";
import DisplayName from "./DisplayName.jsx";
import ProjectList from "./ProjectList.jsx";
import ProjectPage from "./ProjectPage.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    // Also fires when the token is refreshed, e.g. after the display name
    // changes, so the header updates right away.
    const unsub = onIdTokenChanged(auth, (u) => {
      setUser(u);
      setTick((t) => t + 1);
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) return <p className="center">Loading…</p>;
  if (!user) return <AuthPage />;

  return (
    <div className="page">
      <header className="top">
        <h1>RoboBench</h1>
        <div className="who">
          <DisplayName user={user} />
          <span>{user.email}</span>
          <button className="ghost" onClick={() => signOut(auth)}>
            Log out
          </button>
        </div>
      </header>

      {project ? (
        <ProjectPage
          project={project}
          user={user}
          onBack={() => setProject(null)}
        />
      ) : (
        <ProjectList user={user} onOpen={setProject} />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./firebase";
import AuthPage from "./AuthPage.jsx";
import ProjectList from "./ProjectList.jsx";
import ProjectPage from "./ProjectPage.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
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

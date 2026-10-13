import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router";
import { views } from "./views";

function ViewList() {
  return (
    <nav className="views">
      <h1>Sandbox</h1>
      <ul>
        {views.map((view) => (
          <li key={view.path}>
            <Link to={view.path}>{view.title}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const router = createBrowserRouter([
  { path: "/", element: <ViewList /> },
  ...views.map(({ path, View }) => ({
    path,
    element: (
      <>
        <View />
        <Link className="back" to="/">
          ← all views
        </Link>
      </>
    ),
  })),
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);


import { RouterProvider } from "react-router-dom";
import { AppProviders } from "./providers/AppProviders";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { router } from "./router";

export function App() {
  return (
    <AppProviders>
      <AppErrorBoundary>
        <RouterProvider router={router} />
      </AppErrorBoundary>
    </AppProviders>
  );
}

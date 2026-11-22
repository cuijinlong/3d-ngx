import { Outlet, type RouteObject } from "react-router-dom";
import { GuestOnly, HomeRedirect, RequireAuth, RequireTenant } from "../auth/AuthSession";
import { RETIRED_APP_PATHS, routes } from "../constants/routes";
import { StudioEditorPage } from "../pages/studio/StudioEditorPage";
import { TwinRuntimePage } from "../pages/digital-twin/TwinRuntimePage";
import { SettingsPage } from "../pages/settings/SettingsPage";
import { LoginPage } from "../pages/login/LoginPage";
import { SelectCustomerPage } from "../pages/entry/SelectCustomerPage";
import { CustomerScenesPage } from "../pages/entry/CustomerScenesPage";
import { DefaultRuntimePage } from "../pages/entry/DefaultRuntimePage";
import { AppErrorPage } from "./AppErrorPage";

function childPath(absolute: string): string {
  return absolute.replace(/^\//, "");
}

export const appRouteObjects: RouteObject[] = [
  {
    path: routes.login,
    errorElement: <AppErrorPage />,
    element: (
      <GuestOnly>
        <LoginPage />
      </GuestOnly>
    ),
  },
  {
    path: "/",
    errorElement: <AppErrorPage />,
    element: (
      <RequireAuth>
        <Outlet />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      ...RETIRED_APP_PATHS.map((path) => ({ path: childPath(path), element: <HomeRedirect /> })),
      {
        path: "studio/scenes",
        element: (
          <RequireTenant>
            <HomeRedirect />
          </RequireTenant>
        ),
      },
      {
        path: "customers",
        element: (
          <RequireTenant>
            <SelectCustomerPage />
          </RequireTenant>
        ),
      },
      {
        path: "customers/:customerId/scenes",
        element: (
          <RequireTenant>
            <CustomerScenesPage />
          </RequireTenant>
        ),
      },
      { path: "runtime", element: <DefaultRuntimePage /> },
      { path: "digital-twin/runtime/:sceneId", element: <TwinRuntimePage /> },
      {
        path: "studio/editor/:sceneId",
        element: (
          <RequireTenant>
            <StudioEditorPage />
          </RequireTenant>
        ),
      },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
];

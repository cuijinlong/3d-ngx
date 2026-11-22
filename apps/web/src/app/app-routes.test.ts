import { isValidElement, type ReactElement } from "react";
import { type RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HomeRedirect, RequireTenant } from "../auth/AuthSession";
import { APP_NAV_ITEMS } from "../constants/nav";
import { RETIRED_APP_PATHS, routes } from "../constants/routes";
import { appRouteObjects } from "./app-routes";

function flatten(routes: RouteObject[], prefix = ""): { path?: string; route: RouteObject; index?: boolean }[] {
  const rows: { path?: string; route: RouteObject; index?: boolean }[] = [];
  for (const route of routes) {
    const path = route.path
      ? `${prefix}${route.path.startsWith("/") ? route.path : `${prefix.endsWith("/") || prefix === "" ? "" : "/"}${route.path}`}`
      : prefix || "/";
    rows.push({ path, route, index: route.index });
    if (route.children) rows.push(...flatten(route.children, path === "/" ? "/" : path));
  }
  return rows;
}

function elementType(route?: RouteObject): unknown {
  const element = route?.element;
  if (!isValidElement(element)) return undefined;
  return element.type;
}

describe("entry routes for login split", () => {
  const rows = flatten(appRouteObjects);

  it("adds /login, /customers, /customers/:customerId/scenes, and /runtime without a /3d-ngx prefix", () => {
    const paths = rows.map((row) => row.path);
    expect(paths).toContain("/login");
    expect(paths).toContain("/customers");
    expect(paths).toContain("/customers/:customerId/scenes");
    expect(paths).toContain("/runtime");
    expect(paths).toContain("/settings");
    expect(paths).toContain("/studio/scenes");
    expect(paths).toContain("/studio/editor/:sceneId");
    expect(paths).toContain("/digital-twin/runtime/:sceneId");
    expect(paths.every((path) => path && !path.startsWith("/3d-ngx"))).toBe(true);
    expect(routes.login).toBe("/login");
    expect(routes.runtime).toBe("/runtime");
  });

  it("keeps settings and the existing scene runtime address", () => {
    expect(rows.some((row) => row.path === "/settings" && elementType(row.route))).toBe(true);
    expect(rows.some((row) => row.path === "/digital-twin/runtime/:sceneId" && elementType(row.route))).toBe(true);
    expect(routes.twinRuntime("demo")).toBe("/digital-twin/runtime/demo");
  });

  it.each([...RETIRED_APP_PATHS])("redirects retired path %s to the current customer scope", (absolute) => {
    const route = rows.find((item) => item.path === absolute)?.route;
    expect(route, `missing route for ${absolute}`).toBeTruthy();
    expect(elementType(route)).toBe(HomeRedirect);
  });

  it("sends the unscoped /studio/scenes list to the current customer scope and leaves only 设置 in the sidebar", () => {
    const route = rows.find((item) => item.path === "/studio/scenes")?.route;
    expect(elementType(route)).toBe(RequireTenant);
    const child = isValidElement(route?.element)
      ? (route?.element as ReactElement<{ children?: ReactElement }>).props.children
      : undefined;
    expect(isValidElement(child) ? child.type : undefined).toBe(HomeRedirect);
    expect(APP_NAV_ITEMS.map((item) => item.label)).toEqual(["设置"]);
    expect(APP_NAV_ITEMS.map((item) => item.to)).toEqual([routes.settings]);
  });
});

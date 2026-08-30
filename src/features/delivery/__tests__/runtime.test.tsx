import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeComponentProvider } from "../../composer/active-pack";
import type { CompositionNode } from "../../../composer/model/types";
import { compileSiteProject } from "../../../site-project/compiler";
import { loadSampleSiteProject } from "../../../site-project/sample";
import { DeliveryRuntime, projectTrustedProps } from "../runtime";

afterEach(cleanup);
const manifest = activeComponentProvider.manifest;
const definition = (id: string) => manifest.components.find((item) => item.id === id)!;
const node = (componentId: string, props: CompositionNode["props"], slots: CompositionNode["slots"] = {}): CompositionNode => ({ id: "node", componentId, componentVersion: 1, props, slots });

describe("trusted delivery props", () => {
  it("starts from defaults and accepts validated fields/static defaults only", () => {
    const cta = definition("ui.cta-button");
    const projected = projectTrustedProps(node(cta.id, { children: "Read", href: "/about", variant: "primary", arrow: true }), cta)!;
    expect(projected).toMatchObject({ children: "Read", href: "/site/about", variant: "primary", arrow: true });
    expect(projectTrustedProps(node(cta.id, { ...cta.defaults, unknown: "no" }), cta)).toBeNull();
    expect(projectTrustedProps(node(cta.id, { ...cta.defaults, children: [], href: "/" }), cta)).toBeNull();
    expect(projectTrustedProps(node(cta.id, { ...cta.defaults, key: "unsafe" }), cta)).toBeNull();
    const stack = definition("ui.stack");
    expect(projectTrustedProps(node(stack.id, { ...stack.defaults, children: "smuggled" }), stack)).toBeNull();
    const withStatic = { ...definition("ui.container"), defaults: { mode: "fixed" }, staticProps: [{ prop: "mode" }] };
    expect(projectTrustedProps(node(withStatic.id, { mode: "fixed" }), withStatic)).toMatchObject({ mode: "fixed" });
    expect(projectTrustedProps(node(withStatic.id, { mode: "changed" }), withStatic)).toBeNull();
  });

  it("rewrites only manifest-declared hrefs including nested schemas", () => {
    const hero = definition("ui.hero");
    const projected = projectTrustedProps(node(hero.id, { ...hero.defaults, heading: "Hello", actions: [
      { label: "Internal", href: "/about", variant: "primary" },
      { label: "Bad", href: "javascript:alert(1)", variant: "secondary" },
    ] }), hero)!;
    expect(projected.actions).toEqual([{ label: "Internal", href: "/site/about", variant: "primary" }, { label: "Bad", variant: "secondary" }]);
  });
});

describe("trusted delivery runtime", () => {
  it("renders all active runtime components and every sample route from evaluated documents", async () => {
    const project = loadSampleSiteProject({ componentPack: manifest });
    const compiled = await compileSiteProject(project, { componentCatalog: activeComponentProvider.catalog });
    expect(compiled.status).toBe("ready"); if (compiled.status !== "ready") return;
    const componentIds = new Set<string>();
    const visit = (nodes: readonly CompositionNode[]): void => { for (const item of nodes) { componentIds.add(item.componentId); Object.values(item.slots).forEach(visit); } };
    for (const route of compiled.build.routes) { visit(route.composition.document.root); if (route.composition.linkedSource) visit(route.composition.linkedSource.document.root); render(<DeliveryRuntime composition={route.composition} pack={activeComponentProvider.pack} />); cleanup(); }
    expect(componentIds).toEqual(new Set(manifest.components.map(({ id }) => id)));
  });

  it("projects single and many slots and linked local roots at the verified outlet despite id collisions", async () => {
    const project = loadSampleSiteProject({ componentPack: manifest });
    const compiled = await compileSiteProject(project, { componentCatalog: activeComponentProvider.catalog });
    if (compiled.status !== "ready") throw new Error("fixture blocked");
    const route = compiled.build.routes.find(({ pathname }) => pathname === "/about")!;
    route.composition.document.root[0]!.id = "site-frame-stack";
    render(<DeliveryRuntime composition={route.composition} pack={activeComponentProvider.pack} />);
    expect(screen.getByRole("heading", { name: "A studio built around useful clarity" })).toBeInTheDocument();
    expect(screen.getByText(/Work made visible/)).toBeInTheDocument();
  });

  it("isolates adapter and component throws and blocks opaque/invalid nodes", async () => {
    const project = loadSampleSiteProject({ componentPack: manifest });
    const compiled = await compileSiteProject(project, { componentCatalog: activeComponentProvider.catalog });
    if (compiled.status !== "ready") throw new Error("fixture blocked");
    const route = compiled.build.routes.find(({ pathname }) => pathname === "/services")!;
    const first = route.composition.document.root[0]!;
    const report = vi.fn();
    const runtime = { ...activeComponentProvider.pack.runtime, components: { ...activeComponentProvider.pack.runtime.components, [first.componentId]: { ...activeComponentProvider.pack.runtime.components[first.componentId]!, component: () => { throw new Error("component boom"); } } } };
    render(<DeliveryRuntime composition={route.composition} pack={{ manifest, runtime }} onComponentError={report} />);
    expect(await screen.findByText("This part of the page could not be displayed.")).toBeInTheDocument(); expect(report).toHaveBeenCalled();
    cleanup();
    const bad = structuredClone(route.composition); bad.document.root[0]!.componentId = "unknown";
    render(<DeliveryRuntime composition={bad} pack={activeComponentProvider.pack} />);
    expect(screen.getByText("An unavailable page component was blocked.")).toBeInTheDocument();
    cleanup();
    const invalidSlot = structuredClone(route.composition); invalidSlot.document.root[0]!.slots.unknown = [];
    render(<DeliveryRuntime composition={invalidSlot} pack={activeComponentProvider.pack} />);
    expect(screen.getByText("An invalid page component was blocked.")).toBeInTheDocument();
    cleanup();
    const adapterRuntime = { ...activeComponentProvider.pack.runtime, components: { ...activeComponentProvider.pack.runtime.components, [first.componentId]: { ...activeComponentProvider.pack.runtime.components[first.componentId]!, adapters: { render: () => { throw new Error("adapter boom"); } } } } };
    render(<DeliveryRuntime composition={route.composition} pack={{ manifest, runtime: adapterRuntime }} onComponentError={report} />);
    expect(await screen.findByText("This part of the page could not be displayed.")).toBeInTheDocument();
  });
});

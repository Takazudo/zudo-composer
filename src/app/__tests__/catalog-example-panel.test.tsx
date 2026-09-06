import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { CatalogEditorialExampleLoader } from "../catalog-example-panel";
import { activeSiteProjectValidationContext as context } from "../site-project-manifest";
afterEach(cleanup);
it("is explicit, cancels without writing and truthfully distinguishes a new project from replacement", async () => {
  const create = vi.fn(async () => true);
  render(<CatalogEditorialExampleLoader context={context} available busy={false} create={create} />);
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Create catalog & editorial example" }));
  expect(screen.getByText(/current workspace is preserved/)).toHaveTextContent("not destructive replacement");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Create catalog & editorial example" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm create separate project" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
});
it("allows detached inspection but cannot create when Media capability is absent or the operation gate is busy", async () => {
  const create = vi.fn();
  const view = render(<CatalogEditorialExampleLoader context={context} available={false} busy={false} create={create} />);
  expect(screen.getByText("Inspect detached example JSON (no writes)")).toBeInTheDocument();
  const details = screen.getByText("Inspect detached example JSON (no writes)").closest("details")!;
  details.open = true; fireEvent(details, new Event("toggle"));
  await waitFor(() => expect(JSON.parse((screen.getByRole("textbox", { name: "Detached example SiteProject JSON" }) as HTMLTextAreaElement).value).id).toBe("catalog-editorial-example"));
  expect(screen.getByRole("button", { name: "Create catalog & editorial example" })).toBeDisabled();
  view.rerender(<CatalogEditorialExampleLoader context={context} available busy create={create} />);
  expect(screen.getByRole("button", { name: "Create catalog & editorial example" })).toBeDisabled();
  expect(create).not.toHaveBeenCalled();
});
it("does not duplicate an in-flight creation and exposes retained additive Media on failure", async () => {
  let reject!: (error: Error) => void;
  const create = vi.fn(() => new Promise<boolean>((_, no) => { reject = no; }));
  render(<CatalogEditorialExampleLoader context={context} available busy={false} create={create} />);
  fireEvent.click(screen.getByRole("button", { name: "Create catalog & editorial example" }));
  const confirm = screen.getByRole("button", { name: "Confirm create separate project" });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(create).toHaveBeenCalledTimes(1);
  reject(new Error("Workspace unavailable"));
  await waitFor(() => expect(screen.getByText(/completed Media import may remain/)).toBeInTheDocument());
  expect(screen.getByText(/Workspace unavailable/)).toBeInTheDocument();
});
it("offers the preserved workspace through the injected existing selection service", () => {
  const open = vi.fn(async () => true);
  render(<CatalogEditorialExampleLoader context={context} available busy={false} create={vi.fn()} previousWorkspace={{ id: "previous-project-workspace", open }} />);
  expect(screen.getByText("previous-project-workspace")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Return to previous workspace" }));
  expect(open).toHaveBeenCalledTimes(1);
});
it("distinguishes a committed workspace with later Media drift from a failed creation", () => {
  render(<CatalogEditorialExampleLoader context={context} available busy={false} create={vi.fn()} creationNotice="The workspace was created; its mutable Media head changed after selection." />);
  expect(screen.getByText("Created workspace: Media changed")).toBeInTheDocument();
  expect(screen.getByText(/mutable Media head changed after selection/)).toBeInTheDocument();
  expect(screen.queryByText("Example not opened")).not.toBeInTheDocument();
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_DELAY_MS } from "../components/forms";
import { fireEvent, render, screen, settle } from "./render";
import { renderNode } from "./render-node";

afterEach(() => {
  vi.useRealTimers();
});

describe("land.signup-form", () => {
  const renderSignup = () => render(renderNode({ id: "signup", componentId: "land.signup-form" }));
  const submit = () => screen.getByRole("button", { name: /Create my calendar|Sending/ }) as HTMLButtonElement;

  it("shows field errors and no success panel when the input is invalid", async () => {
    renderSignup();
    await settle();
    fireEvent.input(screen.getByLabelText("Work email"), { target: { value: "not-an-email" } });
    await settle();
    fireEvent.click(submit());
    await settle();
    expect(screen.getByText("Enter a work email, like name@company.com.")).toBeTruthy();
    expect(screen.getByText("Choose your team size.")).toBeTruthy();
    expect(screen.getByLabelText("Work email").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Demo — no data is sent.")).toBeTruthy();
  });

  it("disables while it fakes a send, then shows the success panel", async () => {
    vi.useFakeTimers();
    renderSignup();
    await settle();
    fireEvent.input(screen.getByLabelText("Work email"), { target: { value: "ana@studio.example" } });
    await settle();
    fireEvent.change(screen.getByLabelText("Team size"), { target: { value: "6–20" } });
    await settle();
    fireEvent.click(submit());
    await settle();
    expect(submit().disabled).toBe(true);
    expect(submit().textContent).toBe("Sending…");
    vi.advanceTimersByTime(MOCK_DELAY_MS - 1);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
    vi.advanceTimersByTime(1);
    await settle();
    const panel = screen.getByRole("status");
    expect(panel.textContent).toContain("Check your inbox");
    expect(panel.textContent).toContain("in this demo, nothing was sent.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("land.contact-form", () => {
  it("requires name, email and message", async () => {
    render(renderNode({ id: "contact", componentId: "land.contact-form" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await settle();
    expect(screen.getByText("Tell us your name.")).toBeTruthy();
    expect(screen.getByText("Enter an email we can reply to.")).toBeTruthy();
    expect(screen.getByText("Write a short message.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the success text after the fake delay", async () => {
    vi.useFakeTimers();
    render(renderNode({ id: "contact", componentId: "land.contact-form" }));
    await settle();
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ana" } });
    await settle();
    fireEvent.input(screen.getByLabelText("Email"), { target: { value: "ana@studio.example" } });
    await settle();
    fireEvent.input(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await settle();
    vi.advanceTimersByTime(MOCK_DELAY_MS);
    await settle();
    expect(screen.getByRole("status").textContent).toContain("your message was not sent anywhere");
  });
});

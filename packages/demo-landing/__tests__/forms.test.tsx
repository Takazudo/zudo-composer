// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_DELAY_MS } from "../components/forms";
import { renderNode } from "./render-node";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("land.signup-form", () => {
  const renderSignup = () => render(renderNode({ id: "signup", componentId: "land.signup-form" }));
  const submit = () => screen.getByRole("button", { name: /Create my calendar|Sending/ }) as HTMLButtonElement;

  it("shows field errors and no success panel when the input is invalid", () => {
    renderSignup();
    fireEvent.input(screen.getByLabelText("Work email"), { target: { value: "not-an-email" } });
    fireEvent.click(submit());
    expect(screen.getByText("Enter a work email, like name@company.com.")).toBeTruthy();
    expect(screen.getByText("Choose your team size.")).toBeTruthy();
    expect(screen.getByLabelText("Work email").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Demo — no data is sent.")).toBeTruthy();
  });

  it("disables while it fakes a send, then shows the success panel", async () => {
    vi.useFakeTimers();
    renderSignup();
    fireEvent.input(screen.getByLabelText("Work email"), { target: { value: "ana@studio.example" } });
    fireEvent.change(screen.getByLabelText("Team size"), { target: { value: "6–20" } });
    fireEvent.click(submit());
    expect(submit().disabled).toBe(true);
    expect(submit().textContent).toBe("Sending…");
    await act(() => { vi.advanceTimersByTime(MOCK_DELAY_MS - 1); });
    expect(screen.queryByRole("status")).toBeNull();
    await act(() => { vi.advanceTimersByTime(1); });
    const panel = screen.getByRole("status");
    expect(panel.textContent).toContain("Check your inbox");
    expect(panel.textContent).toContain("in this demo, nothing was sent.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("land.contact-form", () => {
  it("requires name, email and message", () => {
    render(renderNode({ id: "contact", componentId: "land.contact-form" }));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByText("Tell us your name.")).toBeTruthy();
    expect(screen.getByText("Enter an email we can reply to.")).toBeTruthy();
    expect(screen.getByText("Write a short message.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the success text after the fake delay", async () => {
    vi.useFakeTimers();
    render(renderNode({ id: "contact", componentId: "land.contact-form" }));
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Ana" } });
    fireEvent.input(screen.getByLabelText("Email"), { target: { value: "ana@studio.example" } });
    fireEvent.input(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await act(() => { vi.advanceTimersByTime(MOCK_DELAY_MS); });
    expect(screen.getByRole("status").textContent).toContain("your message was not sent anywhere");
  });
});

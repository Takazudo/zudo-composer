// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Comment, CommentForm, CommentList, Newsletter } from "../components/pack";
import { fireEvent, render, settle } from "./render";
import { resetLocalComments } from "../components/runtime";
import { validateComment } from "../components/comments";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 12));
  history.replaceState(null, "", "/site/articles/the-quiet-hour");
});

afterEach(() => {
  resetLocalComments();
  vi.useRealTimers();
  history.replaceState(null, "", "/");
});

function page() {
  return render(
    <div>
      <CommentList comments={[<Comment key="1" name="Ana" date="May 21, 2026" body="Prefilled comment." articleSlug="the-quiet-hour" />]} />
      <CommentForm />
    </div>,
  );
}

const type = (element: HTMLElement, value: string) => fireEvent.input(element, { target: { value } });

describe("blog.comment-form mock", () => {
  it("validates name, email format and a 10-character comment", async () => {
    expect(validateComment({ name: "", email: "nope", comment: "short" })).toEqual({
      name: "Please add your name.",
      email: "Please enter a valid email address.",
      comment: "Comments need at least 10 characters.",
    });
    expect(validateComment({ name: "Ana", email: "ana@example.com", comment: "Long enough text." })).toEqual({});
  });

  it("shows errors and posts nothing when invalid", async () => {
    const { getByRole, getByText, container } = page();
    await settle();
    fireEvent.click(getByRole("button", { name: "Post comment" }));
    await settle();
    expect(getByText("Please add your name.")).toBeTruthy();
    vi.advanceTimersByTime(1000);
    await settle();
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("disables for 600 ms, then appends the comment locally with the success text", async () => {
    const { getByRole, getByLabelText, container, queryByText, getByText } = page();
    await settle();
    type(getByLabelText("Name"), "Rui");
    await settle();
    type(getByLabelText("Email"), "rui@example.com");
    await settle();
    type(getByLabelText("Comment"), "The hour before email is the one I keep.");
    await settle();
    fireEvent.click(getByRole("button", { name: "Post comment" }));
    await settle();

    expect((getByRole("button", { name: "Posting…" }) as HTMLButtonElement).disabled).toBe(true);
    vi.advanceTimersByTime(599);
    await settle();
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(queryByText("Posted locally — this demo keeps nothing.")).toBeNull();

    vi.advanceTimersByTime(1);
    await settle();
    const items = [...container.querySelectorAll("li")];
    expect(items).toHaveLength(2);
    expect(items[1]!.hidden).toBe(false);
    expect(items[1]!.textContent).toContain("Rui");
    expect(items[1]!.textContent).toContain("Sep 12, 2026");
    expect(items[1]!.textContent).toContain("The hour before email is the one I keep.");
    expect(getByText("Posted locally — this demo keeps nothing.")).toBeTruthy();
    expect(getByText("Demo — no data is sent.")).toBeTruthy();
    expect((getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });
});

describe("blog.newsletter mock", () => {
  it("rejects a bad email, then succeeds after the delay", async () => {
    const { getByRole, getByLabelText, getByText, queryByText } = render(<Newsletter />);
    await settle();
    type(getByLabelText("Email"), "bad");
    await settle();
    fireEvent.click(getByRole("button", { name: "Subscribe" }));
    await settle();
    expect(getByText("Please enter a valid email address.")).toBeTruthy();

    type(getByLabelText("Email"), "me@example.com");
    await settle();
    fireEvent.click(getByRole("button", { name: "Subscribe" }));
    await settle();
    expect(queryByText("Subscribed locally — this demo keeps nothing.")).toBeNull();
    vi.advanceTimersByTime(600);
    await settle();
    expect(getByText("Subscribed locally — this demo keeps nothing.")).toBeTruthy();
  });
});

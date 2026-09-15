// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { ArticleCard, ArticleList, Comment, CommentList, RelatedArticles } from "../components/pack";

// Cards are materialised child nodes in the list's slot, exactly as a collection
// attachment delivers them; the list filters by context, never by array prop.
const cards = () => [
  <ArticleCard key="a" title="Sharpen before you cut" slug="sharpen-before-you-cut" tag1="craft" tag2="tools" authorSlug="teodor-lindqvist" />,
  <ArticleCard key="b" title="The quiet hour" slug="the-quiet-hour" tag1="attention" authorSlug="teodor-lindqvist" />,
  <ArticleCard key="c" title="Reading slowly on purpose" slug="reading-slowly-on-purpose" tag1="attention" tag2="craft" authorSlug="mina-okafor" />,
  <ArticleCard key="d" title="Notes that survive the week" slug="notes-that-survive-the-week" tag1="tools" authorSlug="teodor-lindqvist" />,
];

function visibleTitles(container: Element): string[] {
  return [...container.querySelectorAll("article")].filter((article) => !article.hidden).map((article) => article.querySelector("h3")!.textContent!);
}

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

describe("blog.article-list tag filter", () => {
  it("hides cards whose tags miss the active chip and counts the visible ones", () => {
    const { container, getByRole, getByText } = render(<ArticleList chips articles={cards()} />);
    expect(visibleTitles(container)).toHaveLength(4);
    expect(getByText("4 articles")).toBeTruthy();

    fireEvent.click(getByRole("button", { name: "craft" }));
    expect(visibleTitles(container)).toEqual(["Sharpen before you cut", "Reading slowly on purpose"]);
    expect(getByText("2 articles")).toBeTruthy();
    expect(getByRole("button", { name: "craft" }).getAttribute("aria-pressed")).toBe("true");
    expect(location.search).toBe("?tag=craft");

    fireEvent.click(getByRole("button", { name: "All" }));
    expect(visibleTitles(container)).toHaveLength(4);
    expect(location.search).toBe("");
  });

  it("starts from the ?tag= query and shows the empty text when nothing matches", () => {
    history.replaceState(null, "", "/site/articles?tag=tools");
    const { container, getByText } = render(<ArticleList chips tagOptions={["craft", "tools", "gardening"]} articles={cards()} />);
    expect(visibleTitles(container)).toEqual(["Sharpen before you cut", "Notes that survive the week"]);
    fireEvent.click(getByText("gardening"));
    expect(visibleTitles(container)).toEqual([]);
    expect(getByText("No articles here yet.")).toBeTruthy();
  });

  it("ignores the query when chips are off", () => {
    history.replaceState(null, "", "/site?tag=tools");
    const { container } = render(<ArticleList articles={cards()} />);
    expect(visibleTitles(container)).toHaveLength(4);
  });

  it("keeps only the route author's cards in by-route-author mode", () => {
    history.replaceState(null, "", "/site/authors/mina-okafor");
    const { container } = render(<ArticleList mode="by-route-author" articles={cards()} />);
    expect(visibleTitles(container)).toEqual(["Reading slowly on purpose"]);
  });

  it("renders a card with no host list visibly", () => {
    const { container } = render(<ArticleCard title="Alone" tag1="craft" />);
    expect(visibleTitles(container)).toEqual(["Alone"]);
  });
});

describe("blog.related-articles", () => {
  it("hides the current article and caps the row at the limit", () => {
    history.replaceState(null, "", "/site/articles/sharpen-before-you-cut");
    const { container } = render(<RelatedArticles limit={2} articles={cards()} />);
    expect(visibleTitles(container)).toEqual(["The quiet hour", "Reading slowly on purpose"]);
  });
});

describe("blog.comment-list", () => {
  it("shows only comments for the current article (or unscoped ones)", () => {
    history.replaceState(null, "", "/site/articles/the-quiet-hour");
    const { container } = render(
      <CommentList comments={[
        <Comment key="1" name="Ana" body="On the quiet hour." articleSlug="the-quiet-hour" />,
        <Comment key="2" name="Ben" body="On sharpening." articleSlug="sharpen-before-you-cut" />,
        <Comment key="3" name="Cy" body="Everywhere." />,
      ]} />,
    );
    const visible = [...container.querySelectorAll("li")].filter((item) => !item.hidden).map((item) => item.querySelector("p")!.textContent);
    expect(visible).toEqual(["Ana", "Cy"]);
  });

  it("shows the empty text when no comment matches", () => {
    history.replaceState(null, "", "/site/articles/the-quiet-hour");
    const { getByText } = render(<CommentList comments={[<Comment key="1" name="Ben" body="x" articleSlug="other" />]} />);
    expect(getByText("No comments yet.")).toBeTruthy();
  });
});

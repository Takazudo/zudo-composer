// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GalleryImage, ProductGallery } from "../components/pack";

let host: HTMLElement;

function mount(sources: string[]) {
  act(() => {
    render(<ProductGallery images={sources.map((src, index) => <GalleryImage key={index} src={src} alt={`Image ${index + 1}`} />)} />, host);
  });
}

const shown = () => [...host.querySelectorAll<HTMLImageElement>("img[alt^='Image']")].filter((image) => !image.hidden).map((image) => image.getAttribute("src"));
const thumbnails = () => [...host.querySelectorAll<HTMLButtonElement>("button")];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

describe("product gallery", () => {
  it("shows one image and no thumbnails for a single child", () => {
    mount(["/a"]);
    expect(shown()).toEqual(["/a"]);
    expect(thumbnails()).toHaveLength(0);
  });

  it("skips empty children and shows the first image with a thumbnail per image", () => {
    mount(["/a", "", "/b"]);
    expect(shown()).toEqual(["/a"]);
    expect(thumbnails().map((button) => button.getAttribute("aria-label"))).toEqual(["Show image 1 of 2", "Show image 2 of 2"]);
    expect(thumbnails().map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  });

  it("switches the shown image from a thumbnail click and arrow keys", () => {
    mount(["/a", "/b", "/c"]);
    act(() => thumbnails()[1]!.click());
    expect(shown()).toEqual(["/b"]);
    act(() => { thumbnails()[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(shown()).toEqual(["/c"]);
    act(() => { thumbnails()[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(shown()).toEqual(["/a"]);
    expect(document.activeElement).toBe(thumbnails()[0]);
  });
});

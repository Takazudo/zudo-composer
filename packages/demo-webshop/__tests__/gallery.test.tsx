// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GalleryImage, ProductGallery } from "../components/pack";
import { render, settle } from "./render";

let host: HTMLElement;

async function mount(sources: string[]) {
  host = render(<ProductGallery images={sources.map((src, index) => <GalleryImage key={index} src={src} alt={`Image ${index + 1}`} />)} />).container;
  await settle();
}

const shown = () => [...host.querySelectorAll<HTMLImageElement>("img[alt^='Image']")].filter((image) => !image.hidden).map((image) => image.getAttribute("src"));
const thumbnails = () => [...host.querySelectorAll<HTMLButtonElement>("button")];

describe("product gallery", () => {
  it("shows one image and no thumbnails for a single child", async () => {
    await mount(["/a"]);
    expect(shown()).toEqual(["/a"]);
    expect(thumbnails()).toHaveLength(0);
  });

  it("skips empty children and shows the first image with a thumbnail per image", async () => {
    await mount(["/a", "", "/b"]);
    expect(shown()).toEqual(["/a"]);
    expect(thumbnails().map((button) => button.getAttribute("aria-label"))).toEqual(["Show image 1 of 2", "Show image 2 of 2"]);
    expect(thumbnails().map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  });

  it("switches the shown image from a thumbnail click and arrow keys", async () => {
    await mount(["/a", "/b", "/c"]);
    thumbnails()[1]!.click();
    await settle();
    expect(shown()).toEqual(["/b"]);
    thumbnails()[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settle();
    expect(shown()).toEqual(["/c"]);
    thumbnails()[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settle();
    expect(shown()).toEqual(["/a"]);
    expect(document.activeElement).toBe(thumbnails()[0]);
  });
});

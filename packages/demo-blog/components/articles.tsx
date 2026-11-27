import { Show, computed, getScope, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { createItemRegistry, linkItem, type ItemHost } from "./item-registry";
import { currentRouteSegment, nonEmpty, readingMinutes, visibilityView } from "./runtime";
import { answerLink, slotLink } from "./slot-link";

const CAPTION = "font-blog-sans text-blog-caption font-blog-medium";
const CAPS = `${CAPTION} uppercase tracking-blog-caps`;

export type ArticleListMode = "all" | "by-route-author" | "exclude-route";

export interface ArticleFilter {
  activeTag: string;
  mode: ArticleListMode;
  routeSegment: string;
}

export type ArticleCardData = Pick<ArticleCardProps, "tag1" | "tag2" | "tag3" | "authorSlug" | "slug">;

/** Answered by `blog.article-list` and `blog.related-articles`; the view is whether the card shows. */
export const ARTICLE_CARD_LINK = slotLink<ItemHost<ArticleCardData, boolean>>("blog-article-card");

function readTagParam(): string {
  if (typeof location === "undefined") return "";
  return new URLSearchParams(location.search).get("tag") ?? "";
}

function writeTagParam(tag: string): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const url = new URL(location.href);
  if (tag) url.searchParams.set("tag", tag); else url.searchParams.delete("tag");
  history.replaceState(history.state, "", url);
}

const GRID_COLUMNS = {
  "1": "grid-cols-1",
  "2": "grid-cols-1 blog-sm:grid-cols-2",
  "3": "grid-cols-1 blog-sm:grid-cols-2 blog-lg:grid-cols-3",
} as const;

export interface ArticleListProps {
  chips?: boolean;
  columns?: "1" | "2" | "3";
  mode?: ArticleListMode;
  emptyText?: string;
  tagOptions?: string[];
  articles?: Child | object;
}

export function ArticleList({ chips = false, columns = "2", mode = "all", emptyText = "No articles here yet.", tagOptions = ["craft", "attention", "tools"], articles }: ArticleListProps) {
  const activeTag = signal(chips ? readTagParam() : "");
  const measured = signal(false);
  const routeSegment = currentRouteSegment();
  const { ordered, host } = createItemRegistry<ArticleCardData, boolean>(() => view.value.visible);
  const view: ReadonlySignal<ReturnType<typeof visibilityView<ArticleCardData>>> = computed(() => {
    const filter: ArticleFilter = { activeTag: chips ? activeTag.value : "", mode, routeSegment };
    return visibilityView(ordered.value, (card) => articleCardVisible(filter, card));
  });
  getScope().onActivate(() => {
    measured.value = true;
  });
  const choose = (tag: string) => {
    activeTag.value = tag;
    writeTagParam(tag);
  };
  const chipOptions = [{ value: "", label: "All" }, ...tagOptions.map((tag) => ({ value: tag, label: tag }))];
  return (
    <div class="mx-auto max-w-blog-page" on:blog-article-card={answerLink(ARTICLE_CARD_LINK, host)}>
      {chips ? (
        <div class="mb-blog-vsp-md flex flex-wrap items-center gap-blog-hsp-xs" role="group" aria-label="Filter by tag">
          {chipOptions.map(({ value, label }) => {
            const active = computed(() => value === activeTag.value);
            // The header's current-nav underline already spends this viewport's one accent.
            const activeClass = "bg-blog-surface-2 text-blog-fg-strong";
            return (
              <button
                type="button"
                aria-pressed={active}
                class={computed(() => `px-blog-hsp-sm py-blog-vsp-xs ${CAPS} ${active.value ? activeClass : "text-blog-muted hover:underline"}`)}
                on:click={() => choose(value)}
              >
                {label}
              </button>
            );
          })}
          <Show when={measured}>
            {() => <span class={`ml-auto ${CAPTION} text-blog-muted`} aria-live="polite">{computed(() => (view.value.count === 1 ? "1 article" : `${view.value.count} articles`))}</span>}
          </Show>
        </div>
      ) : null}
      <div class={`grid gap-x-blog-hsp-md gap-y-blog-vsp-lg blog-lg:gap-x-blog-hsp-lg ${GRID_COLUMNS[columns]}`}>{articles as Child}</div>
      <Show when={computed(() => measured.value && view.value.count === 0)}>
        {() => <p class={`${CAPTION} text-blog-muted`}>{emptyText}</p>}
      </Show>
    </div>
  );
}

export interface ArticleCardProps {
  title?: string;
  href?: string;
  intro?: string;
  date?: string;
  src?: string;
  alt?: string;
  tag1?: string;
  tag2?: string;
  tag3?: string;
  authorSlug?: string;
  slug?: string;
}

/** The card's own filter rule against its host list; no host means always shown. */
export function articleCardVisible(list: ArticleFilter | null, card: ArticleCardData): boolean {
  if (!list) return true;
  if (list.activeTag && !nonEmpty([card.tag1, card.tag2, card.tag3]).includes(list.activeTag)) return false;
  if (list.mode === "by-route-author" && card.authorSlug !== list.routeSegment) return false;
  if (list.mode === "exclude-route" && card.slug && card.slug === list.routeSegment) return false;
  return true;
}

export function ArticleCard({ title = "Untitled article", href = "#", intro = "", date = "", src = "", alt = "", tag1 = "", tag2 = "", tag3 = "", authorSlug = "", slug = "" }: ArticleCardProps) {
  const element: Ref<HTMLElement> = { current: null };
  const visible = linkItem(ARTICLE_CARD_LINK, { tag1, tag2, tag3, authorSlug, slug }, element);
  const meta = nonEmpty([date, tag1]).join(" · ");
  return (
    <article ref={element} class="border-t border-blog-border pt-blog-vsp-sm" hidden={computed(() => visible.value === false)} data-slug={slug || undefined}>
      {src ? <img class="mb-blog-vsp-sm block aspect-blog-cover w-full object-cover" src={src} alt={alt} loading="lazy" /> : null}
      {meta ? <p class={`${CAPS} text-blog-muted`}>{meta}</p> : null}
      <h3 class="mt-blog-vsp-xs font-blog-serif text-blog-h3 font-blog-semibold text-blog-fg-strong">
        <a class="hover:underline" href={href}>{title}</a>
      </h3>
      {intro ? <p class="mt-blog-vsp-sm font-blog-serif text-blog-body text-blog-fg">{intro}</p> : null}
    </article>
  );
}

export interface ArticleHeaderProps {
  eyebrow?: string;
  title?: string;
  intro?: string;
  authorName?: string;
  authorHref?: string;
  date?: string;
  bodyLength?: number;
  src?: string;
  alt?: string;
  caption?: string;
  /** Byline avatar slot. A slot, not `authorAvatarSrc`, because the release asset pass pins managed URLs only in props named src/href/poster/url. */
  // A single slot: the contract types it framework-neutrally, bigint included.
  avatar?: Child | object | bigint;
}

export interface AvatarProps {
  src?: string;
  alt?: string;
}

export function Avatar({ src = "", alt = "" }: AvatarProps) {
  return src ? <img class="size-blog-avatar-sm rounded-blog-avatar object-cover" src={src} alt={alt} /> : null;
}

export function ArticleHeader({ eyebrow = "", title = "Article title", intro = "", authorName = "", authorHref = "", date = "", bodyLength = 0, src = "", alt = "", caption = "", avatar }: ArticleHeaderProps) {
  const minutes = readingMinutes(bodyLength);
  const meta = nonEmpty([date, minutes ? `${minutes} min read` : ""]);
  return (
    <header class="pt-blog-vsp-xl">
      <div class="mx-auto max-w-blog-measure">
        {eyebrow ? <p class={`${CAPS} text-blog-muted`}>{eyebrow}</p> : null}
        <h1 data-blog-inline class="mt-blog-vsp-xs font-blog-serif text-blog-h1-sm font-blog-semibold text-blog-fg-strong blog-md:text-blog-h1">{title}</h1>
        {intro ? <p class="mt-blog-vsp-sm font-blog-serif text-blog-lead text-blog-fg">{intro}</p> : null}
        {authorName || meta.length ? (
          <div class="mt-blog-vsp-md flex items-center gap-blog-hsp-sm">
            {avatar as Child}
            <p class={`${CAPTION} text-blog-muted`}>
              {authorName ? (authorHref ? <a class="text-blog-fg-strong hover:underline" href={authorHref}>{authorName}</a> : <span class="text-blog-fg-strong">{authorName}</span>) : null}
              {meta.map((part) => <span key={part}><span aria-hidden="true" class="px-blog-hsp-xs">·</span>{part}</span>)}
            </p>
          </div>
        ) : null}
      </div>
      {src ? (
        <figure class="mt-blog-vsp-lg">
          <img class="block aspect-blog-cover w-full object-cover" src={src} alt={alt} />
          {caption ? <figcaption class={`mx-auto mt-blog-vsp-xs max-w-blog-measure ${CAPTION} text-blog-muted`}>{caption}</figcaption> : null}
        </figure>
      ) : null}
    </header>
  );
}

export interface TagListProps {
  tag1?: string;
  tag2?: string;
  tag3?: string;
  basePath?: string;
}

export function TagList({ tag1 = "", tag2 = "", tag3 = "", basePath = "/" }: TagListProps) {
  const tags = nonEmpty([tag1, tag2, tag3]);
  if (!tags.length) return null;
  const prefix = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return (
    <ul class="mx-auto flex max-w-blog-measure flex-wrap gap-blog-hsp-xs py-blog-vsp-md" aria-label="Tags">
      {tags.map((tag) => (
        <li key={tag}>
          <a class={`${CAPS} text-blog-muted hover:underline`} href={`${prefix}${tag}`}>{tag}</a>
        </li>
      ))}
    </ul>
  );
}

export interface AuthorCardProps {
  name?: string;
  href?: string;
  bio?: string;
  src?: string;
  alt?: string;
  variant?: "inline" | "hero";
}

export function AuthorCard({ name = "Author", href = "", bio = "", src = "", alt = "", variant = "inline" }: AuthorCardProps) {
  if (variant === "hero") {
    return (
      <header class="mx-auto flex max-w-blog-measure flex-col gap-blog-vsp-sm pt-blog-vsp-xl pb-blog-vsp-lg blog-md:flex-row blog-md:items-center blog-md:gap-blog-hsp-xl">
        {src ? <img class="size-blog-avatar-lg shrink-0 rounded-blog-avatar object-cover" src={src} alt={alt} /> : null}
        <div>
          <p class={`${CAPS} text-blog-muted`}>Author</p>
          <h1 class="mt-blog-vsp-xs font-blog-serif text-blog-h1-sm font-blog-semibold text-blog-fg-strong blog-md:text-blog-h1">{name}</h1>
          {bio ? <p class="mt-blog-vsp-sm font-blog-serif text-blog-lead text-blog-fg">{bio}</p> : null}
        </div>
      </header>
    );
  }
  return (
    <aside class="mx-auto mt-blog-vsp-lg flex max-w-blog-measure gap-blog-hsp-sm border-t border-blog-border pt-blog-vsp-md">
      {src ? <img class="size-blog-avatar-lg shrink-0 rounded-blog-avatar object-cover" src={src} alt={alt} /> : null}
      <div>
        <p class="font-blog-serif text-blog-h3 font-blog-semibold text-blog-fg-strong">
          {href ? <a class="hover:underline" href={href}>{name}</a> : name}
        </p>
        {bio ? <p class="mt-blog-vsp-xs font-blog-serif text-blog-body text-blog-fg">{bio}</p> : null}
      </div>
    </aside>
  );
}

export interface AuthorGridProps {
  authors?: Child | object;
}

export function AuthorGrid({ authors }: AuthorGridProps) {
  return <div class="mx-auto grid max-w-blog-page grid-cols-1 gap-x-blog-hsp-lg blog-md:grid-cols-2 [&>aside]:mt-[0]">{authors as Child}</div>;
}

export interface RelatedArticlesProps {
  heading?: string;
  limit?: number;
  articles?: Child | object;
}

export function RelatedArticles({ heading = "", limit = 3, articles }: RelatedArticlesProps) {
  const filter: ArticleFilter = { activeTag: "", mode: "exclude-route", routeSegment: currentRouteSegment() };
  const { ordered, host } = createItemRegistry<ArticleCardData, boolean>(() => view.value.visible);
  const view: ReadonlySignal<ReturnType<typeof visibilityView<ArticleCardData>>> = computed(() => visibilityView(ordered.value, (card) => articleCardVisible(filter, card), limit));
  return (
    <div class="mx-auto max-w-blog-page" on:blog-article-card={answerLink(ARTICLE_CARD_LINK, host)}>
      {heading ? <h2 class="mb-blog-vsp-md font-blog-serif text-blog-h2 font-blog-semibold text-blog-fg-strong">{heading}</h2> : null}
      <div class="grid grid-cols-1 gap-x-blog-hsp-md gap-y-blog-vsp-lg blog-sm:grid-cols-2 blog-lg:grid-cols-3 blog-lg:gap-x-blog-hsp-lg">{articles as Child}</div>
    </div>
  );
}

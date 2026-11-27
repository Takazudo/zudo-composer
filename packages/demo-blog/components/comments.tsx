import { For, Show, computed, getScope, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { createItemRegistry, linkItem, type ItemHost } from "./item-registry";
import {
  EMAIL_PATTERN,
  MOCK_DELAY_MS,
  addLocalComment,
  currentPathname,
  currentRouteSegment,
  formatMediumDate,
  localCommentsSignal,
  visibilityView,
} from "./runtime";
import { answerLink, slotLink } from "./slot-link";

const CAPTION = "font-blog-sans text-blog-caption font-blog-medium";
const CONTROL = "block w-full min-h-blog-control-h border border-blog-border bg-blog-surface px-blog-hsp-sm font-blog-sans text-blog-body text-blog-fg placeholder:text-blog-faint";
const PRIMARY_BUTTON = `min-h-blog-control-h bg-blog-fg-strong px-blog-hsp-md ${CAPTION} text-blog-bg hover:bg-blog-accent-strong disabled:bg-blog-faint`;

/** Answered by `blog.comment-list`; a comment shows when unscoped or scoped to the current route. */
export const COMMENT_LINK = slotLink<ItemHost<{ articleSlug: string }, boolean>>("blog-comment");

export interface CommentListProps {
  emptyText?: string;
  comments?: Child | object;
}

export function CommentList({ emptyText = "No comments yet.", comments }: CommentListProps) {
  const routeSegment = currentRouteSegment();
  const local = localCommentsSignal(currentPathname());
  const measured = signal(false);
  const { ordered, host } = createItemRegistry<{ articleSlug: string }, boolean>(() => view.value.visible);
  const view: ReadonlySignal<ReturnType<typeof visibilityView<{ articleSlug: string }>>> = computed(() =>
    visibilityView(ordered.value, ({ articleSlug }) => !articleSlug || articleSlug === routeSegment),
  );
  getScope().onActivate(() => {
    measured.value = true;
  });
  return (
    <div class="mx-auto max-w-blog-measure" on:blog-comment={answerLink(COMMENT_LINK, host)}>
      <ol class="flex flex-col" aria-label="Comments">
        {comments as Child}
        <For each={local} by={(comment) => comment.id}>
          {(comment) => <Comment name={comment.value.name} date={comment.value.date} body={comment.value.body} articleSlug={comment.value.articleSlug} />}
        </For>
      </ol>
      <Show when={computed(() => measured.value && view.value.count === 0)}>
        {() => <p class={`${CAPTION} text-blog-muted`}>{emptyText}</p>}
      </Show>
    </div>
  );
}

export interface CommentProps {
  name?: string;
  date?: string;
  body?: string;
  articleSlug?: string;
}

export function Comment({ name = "Reader", date = "", body = "", articleSlug = "" }: CommentProps) {
  const element: Ref<HTMLLIElement> = { current: null };
  const visible = linkItem(COMMENT_LINK, { articleSlug }, element);
  return (
    <li ref={element} class="border-t border-blog-border py-blog-vsp-md" hidden={computed(() => visible.value === false)}>
      <p class="font-blog-serif text-blog-h3 font-blog-semibold text-blog-fg-strong">{name}</p>
      {date ? <p class={`${CAPTION} uppercase tracking-blog-caps text-blog-muted`}>{date}</p> : null}
      <p class="mt-blog-vsp-xs whitespace-pre-line font-blog-serif text-blog-body text-blog-fg">{body}</p>
    </li>
  );
}

type CommentErrors = Partial<Record<"name" | "email" | "comment", string>>;

export function validateComment(values: { name: string; email: string; comment: string }): CommentErrors {
  const errors: CommentErrors = {};
  if (!values.name.trim()) errors.name = "Please add your name.";
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = "Please enter a valid email address.";
  if (values.comment.trim().length < 10) errors.comment = "Comments need at least 10 characters.";
  return errors;
}

function mockSubmit(): [ReadonlySignal<boolean>, (done: () => void) => void] {
  const pending = signal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  getScope().onCleanup(() => clearTimeout(timer));
  const run = (done: () => void) => {
    pending.value = true;
    timer = setTimeout(() => {
      pending.value = false;
      done();
    }, MOCK_DELAY_MS);
  };
  return [pending, run];
}

function FieldError({ id, message }: { id: string; message: ReadonlySignal<string | undefined> }) {
  return (
    <Show when={computed(() => Boolean(message.value))}>
      {() => <p id={id} class={`mt-blog-vsp-xs ${CAPTION} text-blog-danger`}>{message}</p>}
    </Show>
  );
}

export interface CommentFormProps {
  heading?: string;
  buttonLabel?: string;
  successText?: string;
}

let nextLocalComment = 0;

export function CommentForm({ heading = "Leave a comment", buttonLabel = "Post comment", successText = "Posted locally — this demo keeps nothing." }: CommentFormProps) {
  const values = { name: signal(""), email: signal(""), comment: signal("") };
  const errors = signal<CommentErrors>({});
  const posted = signal(false);
  const [pending, submit] = mockSubmit();
  const onSubmit = (event: Event) => {
    event.preventDefault();
    const entry = { name: values.name.value, email: values.email.value, comment: values.comment.value };
    const found = validateComment(entry);
    errors.value = found;
    posted.value = false;
    if (Object.keys(found).length) return;
    submit(() => {
      addLocalComment(currentPathname(), { id: `local-${nextLocalComment++}`, name: entry.name.trim(), date: formatMediumDate(new Date()), body: entry.comment.trim(), articleSlug: currentRouteSegment() });
      values.name.value = "";
      values.email.value = "";
      values.comment.value = "";
      posted.value = true;
    });
  };
  const label = `${CAPTION} text-blog-fg-strong`;
  const error = (key: keyof CommentErrors) => computed(() => errors.value[key]);
  const nameError = error("name");
  const emailError = error("email");
  const commentError = error("comment");
  const invalid = (message: ReadonlySignal<string | undefined>) => computed(() => Boolean(message.value));
  const describedBy = (message: ReadonlySignal<string | undefined>, id: string) => computed(() => (message.value ? id : null));
  return (
    <form class="mx-auto flex max-w-blog-measure flex-col gap-blog-vsp-sm pt-blog-vsp-md" novalidate on:submit={onSubmit} aria-busy={pending}>
      {heading ? <h3 class="font-blog-serif text-blog-h3 font-blog-semibold text-blog-fg-strong">{heading}</h3> : null}
      <label class={label}>
        Name
        <input class={`mt-blog-vsp-xs ${CONTROL}`} name="name" modelValue={values.name} aria-invalid={invalid(nameError)} aria-describedby={describedBy(nameError, "blog-comment-name-error")} disabled={pending} />
      </label>
      <FieldError id="blog-comment-name-error" message={nameError} />
      <label class={label}>
        Email
        <input class={`mt-blog-vsp-xs ${CONTROL}`} name="email" type="email" modelValue={values.email} aria-invalid={invalid(emailError)} aria-describedby={describedBy(emailError, "blog-comment-email-error")} disabled={pending} />
      </label>
      <FieldError id="blog-comment-email-error" message={emailError} />
      <label class={label}>
        Comment
        <textarea class={`mt-blog-vsp-xs py-blog-vsp-xs ${CONTROL}`} name="comment" rows={5} modelValue={values.comment} aria-invalid={invalid(commentError)} aria-describedby={describedBy(commentError, "blog-comment-comment-error")} disabled={pending} />
      </label>
      <FieldError id="blog-comment-comment-error" message={commentError} />
      <div class="flex flex-wrap items-center gap-blog-hsp-sm">
        <button class={PRIMARY_BUTTON} type="submit" disabled={pending}>{computed(() => (pending.value ? "Posting…" : buttonLabel))}</button>
        <Show when={posted}>{() => <p class={`${CAPTION} text-blog-success`} role="status">{successText}</p>}</Show>
      </div>
      <p class={`${CAPTION} text-blog-muted`}>Demo — no data is sent.</p>
    </form>
  );
}

export interface NewsletterProps {
  heading?: string;
  lead?: string;
  buttonLabel?: string;
  successText?: string;
}

export function Newsletter({ heading = "The Sunday note", lead = "", buttonLabel = "Subscribe", successText = "Subscribed locally — this demo keeps nothing." }: NewsletterProps) {
  const email = signal("");
  const error = signal("");
  const done = signal(false);
  const [pending, submit] = mockSubmit();
  const onSubmit = (event: Event) => {
    event.preventDefault();
    done.value = false;
    if (!EMAIL_PATTERN.test(email.value.trim())) {
      error.value = "Please enter a valid email address.";
      return;
    }
    error.value = "";
    submit(() => {
      email.value = "";
      done.value = true;
    });
  };
  return (
    <form class="mx-auto flex max-w-blog-measure flex-col gap-blog-vsp-sm" novalidate on:submit={onSubmit} aria-busy={pending}>
      {heading ? <h2 class="font-blog-serif text-blog-h2 font-blog-semibold text-blog-fg-strong">{heading}</h2> : null}
      {lead ? <p class="font-blog-serif text-blog-body text-blog-fg">{lead}</p> : null}
      <div class="flex flex-col gap-blog-vsp-xs blog-sm:flex-row blog-sm:gap-blog-hsp-xs">
        <label class="sr-only" for="blog-newsletter-email">Email</label>
        <input id="blog-newsletter-email" class={CONTROL} type="email" name="email" placeholder="you@example.com" modelValue={email} aria-invalid={computed(() => Boolean(error.value))} disabled={pending} />
        <button class={`shrink-0 ${PRIMARY_BUTTON}`} type="submit" disabled={pending}>{computed(() => (pending.value ? "Sending…" : buttonLabel))}</button>
      </div>
      <Show when={computed(() => error.value !== "")}>{() => <p class={`${CAPTION} text-blog-danger`}>{error}</p>}</Show>
      <Show when={done}>{() => <p class={`${CAPTION} text-blog-success`} role="status">{successText}</p>}</Show>
    </form>
  );
}

import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import {
  EMAIL_PATTERN,
  MOCK_DELAY_MS,
  addLocalComment,
  currentPathname,
  currentRouteSegment,
  formatMediumDate,
  useLocalComments,
  useRegisteredVisibility,
  useVisibilityRegistry,
  type VisibilityRegistry,
} from "./runtime";

const CAPTION = "font-blog-sans text-blog-caption font-blog-medium";
const CONTROL = "block w-full min-h-blog-control-h border border-blog-border bg-blog-surface px-blog-hsp-sm font-blog-sans text-blog-body text-blog-fg placeholder:text-blog-faint";
const PRIMARY_BUTTON = `min-h-blog-control-h bg-blog-fg-strong px-blog-hsp-md ${CAPTION} text-blog-bg hover:bg-blog-accent-strong disabled:bg-blog-faint`;

interface CommentListState {
  routeSegment: string;
  registry: VisibilityRegistry;
}

const CommentListContext = createContext<CommentListState | null>(null);

export interface CommentListProps {
  emptyText?: string;
  comments?: ComponentChildren[];
}

export function CommentList({ emptyText = "No comments yet.", comments }: CommentListProps) {
  const registry = useVisibilityRegistry();
  const routeSegment = currentRouteSegment();
  const local = useLocalComments(currentPathname());
  return (
    <CommentListContext.Provider value={{ routeSegment, registry }}>
      <div class="mx-auto max-w-blog-measure">
        <ol class="flex flex-col" aria-label="Comments">
          {comments}
          {local.map((comment) => <Comment key={comment.id} name={comment.name} date={comment.date} body={comment.body} articleSlug={comment.articleSlug} />)}
        </ol>
        {registry.measured && registry.visibleCount === 0 ? <p class={`${CAPTION} text-blog-muted`}>{emptyText}</p> : null}
      </div>
    </CommentListContext.Provider>
  );
}

export interface CommentProps {
  name?: string;
  date?: string;
  body?: string;
  articleSlug?: string;
}

export function Comment({ name = "Reader", date = "", body = "", articleSlug = "" }: CommentProps) {
  const list = useContext(CommentListContext);
  const matches = !list || !articleSlug || articleSlug === list.routeSegment;
  const visible = useRegisteredVisibility(list?.registry ?? null, matches);
  return (
    <li class="border-t border-blog-border py-blog-vsp-md" hidden={!visible}>
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

function useMockSubmit(): [boolean, (done: () => void) => void] {
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const run = (done: () => void) => {
    setPending(true);
    timer.current = setTimeout(() => { setPending(false); done(); }, MOCK_DELAY_MS);
  };
  return [pending, run];
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} class={`mt-blog-vsp-xs ${CAPTION} text-blog-danger`}>{message}</p> : null;
}

export interface CommentFormProps {
  heading?: string;
  buttonLabel?: string;
  successText?: string;
}

let nextLocalComment = 0;

export function CommentForm({ heading = "Leave a comment", buttonLabel = "Post comment", successText = "Posted locally — this demo keeps nothing." }: CommentFormProps) {
  const [values, setValues] = useState({ name: "", email: "", comment: "" });
  const [errors, setErrors] = useState<CommentErrors>({});
  const [posted, setPosted] = useState(false);
  const [pending, submit] = useMockSubmit();
  const update = (key: keyof typeof values) => (event: Event) => setValues({ ...values, [key]: (event.currentTarget as HTMLInputElement).value });
  const onSubmit = (event: Event) => {
    event.preventDefault();
    const found = validateComment(values);
    setErrors(found);
    setPosted(false);
    if (Object.keys(found).length) return;
    const entry = { ...values };
    submit(() => {
      addLocalComment(currentPathname(), { id: `local-${nextLocalComment++}`, name: entry.name.trim(), date: formatMediumDate(new Date()), body: entry.comment.trim(), articleSlug: currentRouteSegment() });
      setValues({ name: "", email: "", comment: "" });
      setPosted(true);
    });
  };
  const label = `${CAPTION} text-blog-fg-strong`;
  return (
    <form class="mx-auto flex max-w-blog-measure flex-col gap-blog-vsp-sm pt-blog-vsp-md" noValidate onSubmit={onSubmit} aria-busy={pending}>
      {heading ? <h3 class="font-blog-serif text-blog-h3 font-blog-semibold text-blog-fg-strong">{heading}</h3> : null}
      <label class={label}>
        Name
        <input class={`mt-blog-vsp-xs ${CONTROL}`} name="name" value={values.name} onInput={update("name")} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "blog-comment-name-error" : undefined} disabled={pending} />
      </label>
      <FieldError id="blog-comment-name-error" message={errors.name} />
      <label class={label}>
        Email
        <input class={`mt-blog-vsp-xs ${CONTROL}`} name="email" type="email" value={values.email} onInput={update("email")} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "blog-comment-email-error" : undefined} disabled={pending} />
      </label>
      <FieldError id="blog-comment-email-error" message={errors.email} />
      <label class={label}>
        Comment
        <textarea class={`mt-blog-vsp-xs py-blog-vsp-xs ${CONTROL}`} name="comment" rows={5} value={values.comment} onInput={update("comment")} aria-invalid={Boolean(errors.comment)} aria-describedby={errors.comment ? "blog-comment-comment-error" : undefined} disabled={pending} />
      </label>
      <FieldError id="blog-comment-comment-error" message={errors.comment} />
      <div class="flex flex-wrap items-center gap-blog-hsp-sm">
        <button class={PRIMARY_BUTTON} type="submit" disabled={pending}>{pending ? "Posting…" : buttonLabel}</button>
        {posted ? <p class={`${CAPTION} text-blog-success`} role="status">{successText}</p> : null}
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
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, submit] = useMockSubmit();
  const onSubmit = (event: Event) => {
    event.preventDefault();
    setDone(false);
    if (!EMAIL_PATTERN.test(email.trim())) { setError("Please enter a valid email address."); return; }
    setError("");
    submit(() => { setEmail(""); setDone(true); });
  };
  return (
    <form class="mx-auto flex max-w-blog-measure flex-col gap-blog-vsp-sm" noValidate onSubmit={onSubmit} aria-busy={pending}>
      {heading ? <h2 class="font-blog-serif text-blog-h2 font-blog-semibold text-blog-fg-strong">{heading}</h2> : null}
      {lead ? <p class="font-blog-serif text-blog-body text-blog-fg">{lead}</p> : null}
      <div class="flex flex-col gap-blog-vsp-xs blog-sm:flex-row blog-sm:gap-blog-hsp-xs">
        <label class="sr-only" for="blog-newsletter-email">Email</label>
        <input id="blog-newsletter-email" class={CONTROL} type="email" name="email" placeholder="you@example.com" value={email} onInput={(event) => setEmail((event.currentTarget as HTMLInputElement).value)} aria-invalid={Boolean(error)} disabled={pending} />
        <button class={`shrink-0 ${PRIMARY_BUTTON}`} type="submit" disabled={pending}>{pending ? "Sending…" : buttonLabel}</button>
      </div>
      {error ? <p class={`${CAPTION} text-blog-danger`}>{error}</p> : null}
      {done ? <p class={`${CAPTION} text-blog-success`} role="status">{successText}</p> : null}
    </form>
  );
}

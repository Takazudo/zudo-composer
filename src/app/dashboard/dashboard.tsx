import type { ComponentChildren, JSX } from "preact";
import {
  ArrowDownIcon,
  ComposerIcon,
  FolderIcon,
  LibraryIcon,
  PlusIcon,
  SavedIcon,
  UploadIcon,
  type IconComponent,
} from "../../components/icons";
// Imported from the module rather than the `library-page` barrel: the barrel
// ships the whole library pattern and its stylesheet, and the Dashboard needs
// only this pure timestamp vocabulary.
import { formatLibraryTimestamp, formatLibraryTimestampFull } from "../../components/library-page/library-format";
import { Banner, Button, Chip, CountBadge, EmptyState, StatusChip, cx } from "../../components/ui";
import { formatIntent } from "../route-intents";
import type {
  WorkspaceAttention,
  WorkspaceAttentionItem,
  WorkspaceRecord,
  WorkspaceSourceName,
  WorkspaceSummary,
} from "../workspace-summary";
import {
  SOURCE_LABELS,
  attentionPresentation,
  attentionView,
  greeting,
  isEmptyWorkspace,
  lastWrite,
  pipelineStages,
  recordKindPresentation,
  statCards,
  type LastWrite,
  type StatCard,
} from "./dashboard-model";
import { useWorkspaceView } from "./use-workspace-view";
import "./dashboard.css";

export interface DashboardProps {
  /**
   * The chrome's single read model. Omitted only where no provider graph is
   * mounted, which leaves the page as its hero and quick actions.
   */
  summary?: WorkspaceSummary;
  /** Injected by tests so the greeting does not depend on the wall clock. */
  now?: Date;
}

const NEW_COMPOSITION_HREF = formatIntent({ route: "composer", action: "new" });

/**
 * The Home route (issue #173): what is in this workspace, what changed, and
 * what is blocking — rendered from `workspace-summary.ts` and nothing else.
 *
 * The page never shows a number it cannot vouch for. Every source resolves
 * independently, so a provider that could not be read degrades its own card to
 * `Unavailable · Retry` while the rest of the page keeps working.
 */
export function Dashboard({ summary, now }: DashboardProps): JSX.Element {
  const view = useWorkspaceView(summary);
  const { counts, recent, attention, loading, error, reload } = view;
  const mediaReady = counts?.media.status === "ok";
  const empty = counts !== null && isEmptyWorkspace(counts);
  // Recent activity and the attention list are answers about records. With no
  // summary mounted, or after one that rejected, there is no answer to give —
  // and an empty card would read as "nothing has changed", which is a claim.
  const answered = loading || counts !== null;

  return (
    <main class="cms-dash" aria-label="Dashboard">
      <header class="cms-dash__hero">
        <div class="cms-dash__greeting">
          <h1>{greeting(now)}</h1>
          <p>Everything in this workspace lives in this browser.</p>
        </div>
        {empty ? null : <QuickActions mediaReady={mediaReady} />}
      </header>

      {error ? (
        <Banner tone="err" title="This workspace could not be read." action={<Button size="sm" onClick={reload}>Retry</Button>}>
          {error}
        </Banner>
      ) : null}

      {counts === null ? (
        loading ? <StatsSkeleton /> : null
      ) : empty ? (
        <StartHere mediaReady={mediaReady} />
      ) : (
        <section class="cms-dash__stats" aria-label="Workspace status">
          {statCards(counts).map((card) => (
            <StatCardView key={card.id} card={card} onRetry={reload} />
          ))}
        </section>
      )}

      <div class={cx("cms-dash__columns", empty && "cms-dash__columns--single")}>
        {empty || !answered ? null : (
          <DashCard title="Recent activity" titleId="cms-dash-recent" note="across all workspaces">
            {recent === null ? (
              <p class="cms-dash__placeholder">Reading the workspace…</p>
            ) : (
              <>
                {recent.unavailable.length > 0 ? (
                  <div class="cms-dash-card__pad">
                    <SourcesUnavailable
                      sources={recent.unavailable.map(({ source }) => source)}
                      sentence={(listed) => `Records from ${listed} are not in this list.`}
                      onRetry={reload}
                    />
                  </div>
                ) : null}
                {recent.records.length > 0 ? (
                  <div class="cms-dash-recent">
                    {recent.records.map((record) => (
                      <RecentRow key={`${record.kind}:${record.href}:${record.id}`} record={record} />
                    ))}
                  </div>
                ) : recent.unavailable.length > 0 ? null : (
                  <EmptyState
                    inline
                    title="Nothing has been edited yet"
                    description="Records you create in any workspace show up here, newest first."
                  />
                )}
              </>
            )}
          </DashCard>
        )}

        <div class="cms-dash__side">
          {empty || !answered ? null : <AttentionCard attention={attention} onRetry={reload} />}

          <DashCard title="How the pieces connect" titleId="cms-dash-pipeline">
            <div class="cms-dash-pipeline">
              {pipelineStages(counts).map((stage, index) => {
                const StageIcon = stage.icon;
                return (
                  <div key={stage.id}>
                    {index === 0 ? null : (
                      <div class="cms-dash-pipeline__arrow" aria-hidden="true">
                        <ArrowDownIcon size="xs" />
                      </div>
                    )}
                    <a class="cms-dash-pipeline__stage" href={stage.href}>
                      <span class="cms-dash-tile"><StageIcon size="sm" /></span>
                      <span class="cms-dash-pipeline__text">
                        <strong>{stage.label}</strong>
                        <span>{stage.description}</span>
                      </span>
                      {stage.count === undefined ? null : <span class="cms-dash-pipeline__count">{stage.count}</span>}
                    </a>
                  </div>
                );
              })}
            </div>
          </DashCard>

          <StorageCard mediaReady={mediaReady} recentLastWrite={recent === null ? null : lastWrite(recent)} />
        </div>
      </div>
    </main>
  );
}

function QuickActions({ mediaReady }: { mediaReady: boolean }): JSX.Element {
  return (
    <div class="cms-dash__quick">
      <a class="cms-btn" href="/content">
        <PlusIcon size="sm" />
        New entry
      </a>
      <a class="cms-btn" href={NEW_COMPOSITION_HREF}>
        <PlusIcon size="sm" />
        New composition
      </a>
      {/* Upload authoring is dev-only, so the action appears only once the
          Media provider has actually answered. */}
      {mediaReady ? (
        <a class="cms-btn cms-btn--primary" href="/media">
          <UploadIcon size="sm" />
          Upload media
        </a>
      ) : null}
    </div>
  );
}

function StartHere({ mediaReady }: { mediaReady: boolean }): JSX.Element {
  return (
    <section class="cms-dash__start" aria-label="Start here">
      <EmptyState
        icon={ComposerIcon}
        title="Start here"
        description="This workspace has no records yet. Define a Content model to hold the words, build a Composition to shape a page, then bind them with a Mapping and place them on a Sitemap."
        action={<QuickActions mediaReady={mediaReady} />}
      />
    </section>
  );
}

/**
 * Deliberately unnamed: an author waiting on the first read has no workspace
 * status yet, and a placeholder region carrying that name would answer a
 * `Workspace status` query with a card that holds no number.
 */
function StatsSkeleton(): JSX.Element {
  return (
    <div class="cms-dash__stats" aria-busy="true">
      <p class="cms-sr-only" role="status">Reading the workspace…</p>
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} class="cms-dash-stat cms-dash-stat--skeleton" aria-hidden="true">
          <span class="cms-dash-stat__bar cms-dash-stat__bar--head" />
          <span class="cms-dash-stat__bar cms-dash-stat__bar--num" />
          <span class="cms-dash-stat__bar" />
        </div>
      ))}
    </div>
  );
}

function StatCardView({ card, onRetry }: { card: StatCard; onRetry: () => void }): JSX.Element {
  const CardIcon = card.icon;
  const head = (
    <span class="cms-dash-stat__head">
      <CardIcon size="sm" />
      {card.label}
    </span>
  );

  if (card.status === "unavailable") {
    return (
      <div class="cms-dash-stat cms-dash-stat--unavailable">
        {head}
        <StatusChip state="failed" label="Unavailable" detail={card.error} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <a class="cms-dash-stat" href={card.href}>
      {head}
      <span class="cms-dash-stat__num">
        <span class="cms-dash-stat__value">{card.value}</span>
        {card.unit ? <small>{card.unit}</small> : null}
      </span>
      <span class="cms-dash-stat__foot">
        {card.alert ? <Chip tone="warn" dot>{card.alert}</Chip> : null}
        {card.detail.length > 0 ? <span>{card.detail.join(" · ")}</span> : null}
      </span>
    </a>
  );
}

function RecentRow({ record }: { record: WorkspaceRecord }): JSX.Element {
  const kind = recordKindPresentation(record.kind);
  const KindIcon = kind.icon;
  return (
    <a class="cms-dash-recent__row" href={record.href}>
      <span class="cms-dash-tile"><KindIcon size="sm" /></span>
      <span class="cms-dash-recent__text">
        <strong>{record.label}</strong>
        <span class="cms-dash-recent__id">{record.id}</span>
      </span>
      <Chip tone={kind.accent ? "accent" : "plain"}>{kind.label}</Chip>
      <time dateTime={record.updatedAt} title={formatLibraryTimestampFull(record.updatedAt)}>
        {formatLibraryTimestamp(record.updatedAt)}
      </time>
    </a>
  );
}

function AttentionCard({ attention, onRetry }: { attention: WorkspaceAttention | null; onRetry: () => void }): JSX.Element {
  const view = attention === null ? null : attentionView(attention);
  return (
    <DashCard title="Needs attention" titleId="cms-dash-attention" count={view?.total}>
      <div class="cms-dash-card__pad cms-dash-attention">
        {view === null ? (
          <p class="cms-dash__placeholder">Reading the workspace…</p>
        ) : (
          <>
            {view.unavailable.length > 0 ? (
              <SourcesUnavailable
                sources={view.unavailable.map(({ source }) => source)}
                sentence={(listed) => `${listed} could not be checked.`}
                onRetry={onRetry}
              />
            ) : null}
            {view.rows.map((item) => (
              <AttentionRow key={`${item.kind}:${item.href}:${item.id}`} item={item} />
            ))}
            {view.hidden > 0 ? (
              <p class="cms-dash__placeholder">{`${view.hidden} more ${view.hidden === 1 ? "needs" : "need"} attention.`}</p>
            ) : null}
            {view.total === 0 && view.unavailable.length === 0 ? (
              <EmptyState inline title="Nothing needs attention" description="Blocked Mappings, unassigned pages and incomplete Entries appear here." />
            ) : null}
          </>
        )}
      </div>
    </DashCard>
  );
}

function AttentionRow({ item }: { item: WorkspaceAttentionItem }): JSX.Element {
  const { icon: RowIcon, action } = attentionPresentation(item.kind);
  return (
    <div class="cms-dash-attention__row">
      <span class="cms-dash-tile"><RowIcon size="sm" /></span>
      <span class="cms-dash-attention__text">
        <strong>{item.label}</strong>
        <span>{item.detail}</span>
      </span>
      {/* Several rows share one verb, so the link carries the record in its
          accessible name rather than announcing "Fix" three times. */}
      <a class="cms-btn cms-btn--sm" href={item.href} aria-label={`${action} ${item.label}`}>
        {action}
      </a>
    </div>
  );
}

function SourcesUnavailable({
  sources,
  sentence,
  onRetry,
}: {
  sources: readonly WorkspaceSourceName[];
  /** Receives the sources as one English list, e.g. "Mappings and Content". */
  sentence: (listed: string) => string;
  onRetry: () => void;
}): JSX.Element {
  const names = sources.map((source) => SOURCE_LABELS[source]);
  const listed = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  return (
    <Banner tone="warn" action={<Button size="sm" onClick={onRetry}>Retry</Button>}>
      {sentence(listed)}
    </Banner>
  );
}

function StorageCard({
  mediaReady,
  recentLastWrite,
}: {
  mediaReady: boolean;
  recentLastWrite: LastWrite | null;
}): JSX.Element {
  return (
    <DashCard title="Storage" titleId="cms-dash-storage">
      <div class="cms-dash-card__pad cms-dash-storage">
        <StorageRow icon={LibraryIcon} label="Browser storage">
          <span class="cms-dash-storage__value">IndexedDB · zudo-composer</span>
        </StorageRow>
        <StorageRow icon={FolderIcon} label="Media files">
          {mediaReady ? <Chip tone="plain">Dev only</Chip> : <Chip tone="plain">Not connected</Chip>}
        </StorageRow>
        <StorageRow icon={SavedIcon} label="Last write">
          {recentLastWrite === null || recentLastWrite.status === "unknown" ? (
            <span class="cms-dash-storage__value">Not known</span>
          ) : recentLastWrite.status === "none" ? (
            <span class="cms-dash-storage__value">No records yet</span>
          ) : (
            <time class="cms-dash-storage__value" dateTime={recentLastWrite.at} title={formatLibraryTimestampFull(recentLastWrite.at)}>
              {formatLibraryTimestamp(recentLastWrite.at)}
            </time>
          )}
        </StorageRow>
      </div>
    </DashCard>
  );
}

function StorageRow({ icon: RowIcon, label, children }: { icon: IconComponent; label: string; children: ComponentChildren }): JSX.Element {
  return (
    <div class="cms-dash-storage__row">
      <RowIcon size="sm" class="cms-dash-storage__icon" />
      <span class="cms-dash-storage__label">{label}</span>
      {children}
    </div>
  );
}

function DashCard({
  title,
  titleId,
  note,
  count,
  children,
}: {
  title: string;
  titleId: string;
  note?: string;
  count?: number;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <section class="cms-dash-card" aria-labelledby={`${titleId}-title`}>
      <div class="cms-dash-card__head">
        <h2 id={`${titleId}-title`}>{title}</h2>
        {count === undefined ? null : <CountBadge count={count} />}
        {note ? <span class="cms-dash-card__note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

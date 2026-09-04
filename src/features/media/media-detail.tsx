import type { JSX } from "preact";
import type { MediaSummary } from "../../media";
import { FolderIcon, TrashIcon } from "../../components/icons";
import { formatLibraryTimestamp, formatLibraryTimestampFull, toLibraryDate } from "../../components/library-page";
import { Button, EmptyState, Field, Input, Pane, PaneBody, PaneHeader } from "../../components/ui";
import { mediaMarkdown, mediaUrl } from "./controller";
import type { MediaDimensionStore } from "./media-dimensions";
import { formatBytes, formatPixelSize, isMediaImage, mediaTypeLabel } from "./media-format";
import { MediaThumb } from "./media-thumb";

export interface MediaDetailPanelProps {
  record: MediaSummary | null;
  dimensions: MediaDimensionStore;
  onCopyUrl(record: MediaSummary): void;
  onCopyMarkdown(record: MediaSummary): void;
  onDelete(record: MediaSummary): void;
}

/**
 * The persistent detail panel.
 *
 * There is deliberately no Replace action: the file-provider protocol carries
 * upload and delete only, and its `put()` rejects. There is no alt text field
 * either — alt belongs to the reference, not to the asset, and the Media model
 * stores none.
 */
export function MediaDetailPanel({ record, dimensions, onCopyUrl, onCopyMarkdown, onDelete }: MediaDetailPanelProps): JSX.Element {
  return (
    <Pane class="sg-media-detail" label="Media details">
      <PaneHeader title="Details" />
      <PaneBody padded>
        {record ? (
          <MediaDetail
            record={record}
            dimensions={dimensions}
            onCopyUrl={onCopyUrl}
            onCopyMarkdown={onCopyMarkdown}
            onDelete={onDelete}
          />
        ) : (
          <EmptyState
            inline
            icon={FolderIcon}
            title="No asset selected"
            description="Choose an asset to read its public URL, copy a Markdown reference, or delete it."
          />
        )}
      </PaneBody>
    </Pane>
  );
}

function MediaDetail({
  record,
  dimensions,
  onCopyUrl,
  onCopyMarkdown,
  onDelete,
}: MediaDetailPanelProps & { record: MediaSummary }): JSX.Element {
  const size = isMediaImage(record) ? dimensions.get(record.id) : undefined;
  const added = toLibraryDate(record.createdAt);
  const url = mediaUrl(record);

  return (
    <div class="sg-media-detail__body">
      <div class="sg-media-detail__preview">
        <MediaThumb record={record} dimensions={dimensions} detail />
      </div>
      <h2 class="sg-media-detail__name" title={record.fileName}>{record.fileName}</h2>

      <dl class="sg-media-detail__facts">
        <div>
          <dt>Type</dt>
          <dd>{mediaTypeLabel(record.mediaType)}</dd>
        </div>
        {size ? (
          <div>
            <dt>Dimensions</dt>
            <dd>{formatPixelSize(size)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(record.byteLength)}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>
            {added ? (
              <time dateTime={added.toISOString()} title={formatLibraryTimestampFull(added)}>
                {formatLibraryTimestamp(added)}
              </time>
            ) : "—"}
          </dd>
        </div>
        <div>
          <dt>ID</dt>
          <dd class="sg-media-detail__id">{record.id}</dd>
        </div>
      </dl>

      <Field label="Public URL">
        <div class="sg-media-detail__copy">
          <Input size="sm" class="sg-media-detail__value" value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
          <Button size="sm" onClick={() => onCopyUrl(record)}>Copy</Button>
        </div>
      </Field>
      <Field label="Markdown">
        <div class="sg-media-detail__copy">
          <Input size="sm" class="sg-media-detail__value" value={mediaMarkdown(record)} readOnly onFocus={(event) => event.currentTarget.select()} />
          <Button size="sm" onClick={() => onCopyMarkdown(record)}>Copy Markdown</Button>
        </div>
      </Field>

      <Button variant="danger" size="sm" class="sg-media-detail__delete" onClick={() => onDelete(record)}>
        <TrashIcon size="sm" />
        Delete…
      </Button>
    </div>
  );
}

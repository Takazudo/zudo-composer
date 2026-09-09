import type { JSX } from "preact";
import type { AssetSummary } from "../../assets";
import { FolderIcon, TrashIcon } from "../../components/icons";
import { formatLibraryTimestamp, formatLibraryTimestampFull, toLibraryDate } from "../../components/library-page";
import { Button, EmptyState, Field, Input, Pane, PaneBody, PaneHeader } from "../../components/ui";
import { assetMarkdown, assetUrl } from "./controller";
import type { AssetDimensionStore } from "./assets-dimensions";
import { formatBytes, formatPixelSize, isAssetImage, assetTypeLabel } from "./assets-format";
import { AssetThumb } from "./assets-thumb";

export interface AssetDetailPanelProps {
  record: AssetSummary | null;
  dimensions: AssetDimensionStore;
  onCopyUrl(record: AssetSummary): void;
  onCopyMarkdown(record: AssetSummary): void;
  onDelete(record: AssetSummary): void;
}

/**
 * The persistent detail panel.
 *
 * There is deliberately no Replace action: the file-provider protocol carries
 * upload and delete only, and its `put()` rejects. There is no alt text field
 * either — alt belongs to the reference, not to the asset, and the Asset model
 * stores none.
 */
export function AssetDetailPanel({ record, dimensions, onCopyUrl, onCopyMarkdown, onDelete }: AssetDetailPanelProps): JSX.Element {
  return (
    <Pane class="sg-assets-detail" label="Asset details">
      <PaneHeader title="Details" />
      <PaneBody padded>
        {record ? (
          <AssetDetail
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

function AssetDetail({
  record,
  dimensions,
  onCopyUrl,
  onCopyMarkdown,
  onDelete,
}: AssetDetailPanelProps & { record: AssetSummary }): JSX.Element {
  const size = isAssetImage(record) ? dimensions.get(record.id) : undefined;
  const added = toLibraryDate(record.createdAt);
  const url = assetUrl(record);

  return (
    <div class="sg-assets-detail__body">
      <div class="sg-assets-detail__preview">
        <AssetThumb record={record} dimensions={dimensions} detail />
      </div>
      <h2 class="sg-assets-detail__name" title={record.fileName}>{record.fileName}</h2>

      <dl class="sg-assets-detail__facts">
        <div>
          <dt>Type</dt>
          <dd>{assetTypeLabel(record.mimeType)}</dd>
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
          <dd class="sg-assets-detail__id">{record.id}</dd>
        </div>
      </dl>

      <Field label="Public URL">
        <div class="sg-assets-detail__copy">
          <Input size="sm" class="sg-assets-detail__value" value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
          <Button size="sm" onClick={() => onCopyUrl(record)}>Copy</Button>
        </div>
      </Field>
      <Field label="Markdown">
        <div class="sg-assets-detail__copy">
          <Input size="sm" class="sg-assets-detail__value" value={assetMarkdown(record)} readOnly onFocus={(event) => event.currentTarget.select()} />
          <Button size="sm" onClick={() => onCopyMarkdown(record)}>Copy Markdown</Button>
        </div>
      </Field>

      <Button variant="danger" size="sm" class="sg-assets-detail__delete" onClick={() => onDelete(record)}>
        <TrashIcon size="sm" />
        Delete…
      </Button>
    </div>
  );
}

import { hostedControlLabels } from "./field-control";
import type { HostedControlLabels } from "./field-control";
import type { HostedErrorCode } from "./types";

export interface HostedEditorLabels extends HostedControlLabels {
  save: string; preview: string; submit: string; loading: string;
  clean: string; dirty: string; saving: string; saved: string; recovering: string; conflict: string; blocked: string; failed: string;
  content: string; edit: string; create: string; addExisting: string; cancel: string;
  review: string; reapply: string; discard: string; localValue: string; serverValue: string;
  reload: string; refreshStatus: string; statusUnavailable: string; cannotClear: string;
  lastKnownStatus: string; previewCurrent: string; previewRequired: string; submissionIncomplete: string;
  submitted: string; building: string; verified: string; integrated: string; deployed: string; unavailable: string;
}
export const hostedEditorLabels: HostedEditorLabels = {
  ...hostedControlLabels,
  save: "Save", preview: "Preview", submit: "Submit", loading: "Loading content…",
  clean: "Saved", dirty: "Unsaved changes", saving: "Saving…", saved: "Saved", recovering: "Recovering save…",
  conflict: "Content changed. Review your retained changes.", blocked: "Editing is paused while the site settings are updated. Your changes are retained.", failed: "Save failed. Your changes are retained.",
  content: "Content", edit: "Edit", create: "Create item", addExisting: "Add existing item", cancel: "Cancel",
  review: "Review current content", reapply: "Reapply my changes", discard: "Discard my changes", localValue: "Your value", serverValue: "Current saved value",
  reload: "Reload saved content", refreshStatus: "Refresh submission status", statusUnavailable: "Submission status is unavailable. The saved draft is retained.", cannotClear: "This field cannot be cleared.",
  lastKnownStatus: "Last confirmed status", previewCurrent: "Current saved content previewed", previewRequired: "Preview the current saved content before submitting.", submissionIncomplete: "Required content is incomplete.",
  submitted: "Submitted", building: "Building", verified: "Verified", integrated: "Integrated", deployed: "Deployed", unavailable: "Unavailable",
};
export const hostedEditorLabelsJa: HostedEditorLabels = {
  clear: "クリア", addItem: "項目を追加", removeItem: "項目を削除", moveUp: "上へ移動", moveDown: "下へ移動", choose: "選択してください", none: "なし", unavailable: "利用できません", asset: "承認済みの素材", item: "項目",
  bold: "太字", italic: "斜体", link: "リンク", heading: "見出し", alt: "代替テキスト", caption: "キャプション", decorative: "装飾目的の画像", label: "ラベル", title: "タイトル", description: "説明", showSize: "ファイルサイズを表示", showType: "ファイル形式を表示",
  save: "保存", preview: "プレビュー", submit: "公開を申請", loading: "コンテンツを読み込んでいます…",
  clean: "保存済み", dirty: "未保存の変更があります", saving: "保存しています…", saved: "保存しました", recovering: "保存結果を確認しています…",
  conflict: "内容が更新されました。保持している変更を確認してください。", blocked: "サイトの設定を更新中のため、編集を一時停止しています。変更内容は保持されています。", failed: "保存できませんでした。変更内容は保持されています。",
  content: "コンテンツ", edit: "編集", create: "項目を作成", addExisting: "既存の項目を追加", cancel: "キャンセル",
  review: "現在の内容を確認", reapply: "自分の変更を再適用", discard: "自分の変更を破棄", localValue: "あなたの値", serverValue: "現在保存されている値",
  reload: "保存済みの内容を再読み込み", refreshStatus: "申請状況を更新", statusUnavailable: "申請状況を取得できません。保存済みの下書きは保持されています。", cannotClear: "この項目は空にできません。",
  lastKnownStatus: "最後に確認できた状況", previewCurrent: "現在の保存内容をプレビュー済み", previewRequired: "申請する前に、現在の保存内容をプレビューしてください。", submissionIncomplete: "必須の内容が入力されていません。",
  submitted: "申請済み", building: "ビルド中", verified: "検証済み", integrated: "反映済み", deployed: "公開済み",
};
/** Routine messages by error code; the error object keeps its technical message and diagnostics for host support. */
export const hostedErrorMessages: Record<HostedErrorCode, string> = {
  "invalid-request": "The request could not be processed. Reload and try again.",
  "invalid-value": "A value is not valid for its field.",
  forbidden: "This change is not permitted.",
  "not-found": "This content is no longer available.",
  "revision-conflict": "Someone else saved first. Review your retained changes.",
  "baseline-conflict": "The published site changed. Review your retained changes.",
  "definition-conflict": "The site settings changed. Review your retained changes.",
  "operation-key-reuse": "This save was already used for different content. Reload and try again.",
  "publication-busy": "A submission is already in progress.",
  incomplete: "Complete the required content before submitting.",
  "restore-incompatible": "This version no longer fits the current fields. Nothing was changed.",
  "configuration-required": "The site settings changed. Your changes are retained until the site is updated.",
  unavailable: "The service is busy. Your changes are retained; try again.",
};
export const hostedErrorMessagesJa: Record<HostedErrorCode, string> = {
  "invalid-request": "リクエストを処理できませんでした。再読み込みしてからもう一度お試しください。",
  "invalid-value": "入力できない値が含まれています。",
  forbidden: "この変更は許可されていません。",
  "not-found": "このコンテンツは利用できなくなりました。",
  "revision-conflict": "ほかの人が先に保存しました。保持している変更を確認してください。",
  "baseline-conflict": "公開中のサイトが更新されました。保持している変更を確認してください。",
  "definition-conflict": "サイトの設定が更新されました。保持している変更を確認してください。",
  "operation-key-reuse": "この保存操作は別の内容で使用済みです。再読み込みしてからもう一度お試しください。",
  "publication-busy": "すでに公開申請が進行中です。",
  incomplete: "申請する前に必須の内容を入力してください。",
  "restore-incompatible": "この版は現在の項目設定に合わないため復元できません。何も変更されていません。",
  "configuration-required": "サイトの設定が更新されました。サイトの更新が終わるまで変更内容は保持されます。",
  unavailable: "混み合っています。変更内容は保持されています。もう一度お試しください。",
};

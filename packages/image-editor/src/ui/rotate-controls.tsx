import { flipCropRect, rotateCropRect } from '../index';
import type { EditorState } from './use-editor-state';
export function RotateControls({ editor }: { editor: EditorState }) {
  function rotate(angle: 90 | 270) {
    const d = editor.current.current;
    editor.update({ ...d, rotate: ((d.rotate + angle) % 360) as typeof d.rotate, flipH: d.flipV, flipV: d.flipH, crop: rotateCropRect(d.crop, angle), resize: { width: d.resize.height, height: d.resize.width } });
  }
  function flip(horizontal: boolean) {
    const d = editor.current.current;
    editor.update({ ...d, crop: flipCropRect(d.crop, horizontal), ...(horizontal ? { flipH: !d.flipH } : { flipV: !d.flipV }) });
  }
  return <div class="zie-controls"><button type="button" onClick={() => rotate(90)}>Rotate 90° clockwise</button><button type="button" onClick={() => rotate(270)}>Rotate 90° counterclockwise</button><button type="button" onClick={() => flip(true)}>Flip horizontal</button><button type="button" onClick={() => flip(false)}>Flip vertical</button></div>;
}

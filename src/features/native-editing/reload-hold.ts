/** Keep the initiating document alive until it has recorded the HTTP outcome. */
export function createNativeReloadHold() {
  let held = 0;
  let reopen: (() => boolean) | undefined;
  return {
    hold() {
      held++;
      return () => {
        if (--held || !reopen) return false;
        const resume = reopen;
        reopen = undefined;
        return resume();
      };
    },
    afterSettlement(resume: () => boolean) {
      if (held) reopen = resume;
      else resume();
    },
  };
}

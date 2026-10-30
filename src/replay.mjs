// FCR reports its playback state through the current play button.
export const replayPlaying = snapshot => {
  const play = snapshot?.actions.play;
  return !!play && (/^pause/i.test(play.label) || (play.active && !/^resume/i.test(play.label)));
};
export const replayCommand = snapshot => replayPlaying(snapshot) ? 'stop' : 'play';
export const canSeek = snapshot => {
  const timeline = snapshot?.timeline;
  return !!timeline && !timeline.disabled && snapshot.actions.connection.active && !snapshot.actions.startrecord.active &&
    [timeline.min, timeline.max, timeline.value].every(Number.isSafeInteger) &&
    timeline.max > timeline.min;
};
export const DEFAULT_STEP_PERCENT = 2;
export const stepPercent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 100
  ? value : DEFAULT_STEP_PERCENT;
export const seekValue = (timeline, ticks, step) => Math.max(timeline.min, Math.min(timeline.max,
  timeline.value + ticks * Math.max(1, Math.round((timeline.max - timeline.min) * stepPercent(step) / 100))));

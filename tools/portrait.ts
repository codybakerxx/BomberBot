/**
 * Large pictures of the robots, for title screens and other artwork.
 * Not part of the game: tools/portraits.py bundles this file, runs it in
 * Chrome and saves one PNG per colour with a transparent background.
 *
 * The robot is drawn by the game's own drawRobot (src/robot.ts), standing
 * still, with no shadow on the ground: from the front, the back or either
 * side. At this size it gets the soft rounding inside each piece that is left
 * out at playing size.
 */
import { colorById, drawRobot } from '../src/render';
import { drawRobotTurned } from '../src/robot';

/**
 * Called from tools/portraits.py: one robot on a transparent canvas, as a PNG data URL. `s` is the size of
 * one tile; the robot is 1.09 tiles tall. `facing` is 2 for the front, 1 the back, 4 its right side, 3 its left.
 */
(window as unknown as { portrait: (id: string, s: number, facing?: 1 | 2 | 3 | 4) => string }).portrait = (id, s, facing = 2) => {
  const cv = document.createElement('canvas');
  cv.width = Math.round(s * 1.2);
  cv.height = Math.round(s * 1.55);
  drawRobot(cv.getContext('2d')!, cv.width / 2, Math.round(s * 1.47), s, colorById(id), facing, 0, false, { noShadow: true });
  return cv.toDataURL('image/png');
};

/** The same, turned part of the way round and seen from a little above (the robot's "isometric" view). */
(window as unknown as { portraitTurned: (id: string, s: number) => string }).portraitTurned = (id, s) => {
  const cv = document.createElement('canvas');
  cv.width = Math.round(s * 1.5);
  cv.height = Math.round(s * 1.7);
  drawRobotTurned(cv.getContext('2d')!, cv.width / 2, Math.round(s * 1.45), s, colorById(id));
  return cv.toDataURL('image/png');
};

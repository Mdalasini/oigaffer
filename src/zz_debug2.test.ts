import { test } from "bun:test";
import { AVERAGE_GRADE, BEST_GRADE, PITCH_LENGTH } from "./constants";
import { bestShot, shotOptions, whereToStand } from "./chance";
import { GOAL_CENTRE } from "./goal";
import type { Point } from "./shooting";

test("profile", () => {
  for (const grade of [AVERAGE_GRADE, BEST_GRADE]) for (const off of [0, 8]) {
    const row: string[] = [];
    for (let d = 30; d >= 8; d -= 2) {
      const from: Point = [PITCH_LENGTH - d, GOAL_CENTRE + off, 0];
      const options = shotOptions(from, grade);
      const keeper = whereToStand(from, options, [PITCH_LENGTH, GOAL_CENTRE]) ?? [PITCH_LENGTH, GOAL_CENTRE];
      const set = bestShot(options, keeper).chance;
      row.push(`${d}:${set.toFixed(2)}`);
    }
    console.log(`grade ${grade} off ${off}`, row.join(" "));
  }
});

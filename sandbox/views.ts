import { DribbleView } from "./views/dribble";
import { OneOnOneView } from "./views/oneOnOne";
import { ShootingView } from "./views/shooting";
import { TakeOnView } from "./views/takeOn";

export const views = [
  { path: "/dribble", title: "Dribble to a clicked spot", View: DribbleView },
  { path: "/shooting", title: "Pick a shot and take it", View: ShootingView },
  { path: "/one-on-one", title: "One-on-ones against the keeper", View: OneOnOneView },
  { path: "/take-on", title: "Beat the defender, then the keeper", View: TakeOnView },
];

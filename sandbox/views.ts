import { DribbleView } from "./views/dribble";
import { ShootingView } from "./views/shooting";

export const views = [
  { path: "/dribble", title: "Dribble to a clicked spot", View: DribbleView },
  { path: "/shooting", title: "Shoot at an empty goal", View: ShootingView },
];

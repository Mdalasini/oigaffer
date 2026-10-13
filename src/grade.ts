import { BEST_GRADE, WORST_GRADE } from "./constants";

export const skill = (grade: number) => (grade - WORST_GRADE) / (BEST_GRADE - WORST_GRADE);

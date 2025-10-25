export function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) {
    return [];
  }
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) {
    return scores.map(() => 1);
  }
  return scores.map(score => (score - min) / (max - min));
}

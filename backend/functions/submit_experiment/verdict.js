"use strict";

// Decides whether a claimed score is backed up by the re-measured score.
// Only a score that is TOO HIGH is suspicious: a model that scores better than
// claimed is fine. The tolerance allows for evaluation noise.
function decide({ claimedMean, claimedStd, measuredMean }) {
  const tolerance = Math.max(0.1 * Math.abs(claimedMean), 2 * (claimedStd || 0), 1);
  const shortfall = claimedMean - measuredMean;

  if (!Number.isFinite(measuredMean) || !Number.isFinite(shortfall)) {
    return { status: "rejected", tolerance, shortfall: null };
  }
  return {
    status: shortfall <= tolerance ? "validated" : "rejected",
    tolerance,
    shortfall,
  };
}

module.exports = { decide };

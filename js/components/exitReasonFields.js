// Shared exit-reason taxonomy (Feature 3 of 3) -- the fixed lists
// behind both the "Mark as left" / "Leave this church" reason form
// (exitReasonDialog in memberExitModal.js) and the reasons chart's
// labels (memberExitChart.js), so the two can never drift out of sync
// with each other or with sql/136_member_exits.sql's enum values.
export const EXIT_REASONS = [
  'needs_not_met', 'changes_disliked', 'leadership_pastor', 'doctrine_political',
  'moved_away', 'conflict_with_members', 'felt_out_of_place', 'family_life_change',
  'other', 'unknown',
];

export const HOW_WE_KNOW = ['exit_conversation', 'message', 'told_by_someone', 'assumed'];

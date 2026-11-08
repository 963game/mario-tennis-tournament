export function teamOf(room, uid) {
  const a = room.teamAUids, b = room.teamBUids, members = room.memberUids;
  if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(members) ||
      !a.length || !b.length || a.some(x => b.includes(x)) ||
      [...a,...b].some(x => typeof x !== 'string' || !members.includes(x)) ||
      members.some(x => !a.includes(x) && !b.includes(x))) return null;
  return a.includes(uid) ? 'A' : b.includes(uid) ? 'B' : null;
}
export function canReview(room, uid) {
  const mine = teamOf(room, uid), reporter = teamOf(room, room.reportedBy);
  return room.status === 'pending' && !!mine && !!reporter && mine !== reporter;
}
export function canReport(room, uid) {
  return !!teamOf(room, uid) && ['unreported','needs_fix'].includes(room.status);
}
export function validScore(a,b) {
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a <= 99 && b <= 99 && a !== b;
}
// Bind approval to the exact report the participant actually saw.
export function sameReport(before, current) {
  return before.status === 'pending' && current.status === 'pending' &&
    before.reportedBy === current.reportedBy &&
    before.scoreA === current.scoreA && before.scoreB === current.scoreB &&
    !!before.updatedAt && !!current.updatedAt &&
    before.updatedAt.seconds === current.updatedAt.seconds &&
    before.updatedAt.nanoseconds === current.updatedAt.nanoseconds;
}
export function participantCredential(code) {
  const match = /^(P\d{2,3})-([^\r\n]{9,128})$/i.exec(code.trim());
  if (!match) throw Error('参加者コードの形式が違います。配布されたコードを省略せず、そのまま貼り付けてください。');
  return {email: match[1].toLowerCase() + '@players.invalid', password: match[2]};
}

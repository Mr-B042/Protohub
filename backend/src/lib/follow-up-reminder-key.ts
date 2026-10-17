// One alert per order per follow-up time (Bright, 17 Oct 2026). The duplicate
// check used to compare the WHOLE message, which ends with the order's status
// note and amount - so editing the order inside the 2h window (order #5038:
// an add-on changed the note to "Assigned to delivery…") made a "new" message
// and the same 4:55 pm reminder went out again at 6:35 pm. Only the fixed
// start (customer · product · the due time) decides whether it was sent.
// trimText cuts at 119 characters, so a fixed start longer than that is
// compared on what survives the cut - identical whatever follows it.
export function followUpReminderKey(message: string, fixedStart: string) {
  return message.slice(0, Math.min(fixedStart.length, 119)).trimEnd();
}

export function sameFollowUpReminder(existingMessage: string, key: string) {
  return existingMessage.startsWith(key);
}

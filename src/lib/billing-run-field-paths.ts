import { FieldPath } from 'firebase/firestore';

/**
 * Firestore interprets "." in update keys as nesting. Split-group labels often contain
 * "." (e.g. "บจก.วนาวัฒน์วัสดุ"), which broke createdBillingNotes writes.
 */
export function fpBillingRunCreatedSeparate(bucketId: string, splitGroupKey: string): FieldPath {
  return new FieldPath('createdBillingNotes', bucketId, 'separate', splitGroupKey);
}

export function fpBillingRunCreatedBucket(bucketId: string): FieldPath {
  return new FieldPath('createdBillingNotes', bucketId);
}

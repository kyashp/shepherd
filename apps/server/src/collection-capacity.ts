export const MAX_DURABLE_COLLECTION_ITEMS = 10_000;

export class DurableCapacityError extends Error {
  readonly statusCode = 507;

  constructor(readonly collection: string) {
    super(`Durable ${collection} capacity is exhausted`);
    this.name = "DurableCapacityError";
  }
}

export function assertWithinDurableCapacity(
  collection: readonly unknown[],
  additionalItems: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(additionalItems) ||
    additionalItems < 0 ||
    collection.length + additionalItems > MAX_DURABLE_COLLECTION_ITEMS
  ) {
    throw new DurableCapacityError(label);
  }
}

export function appendWithinDurableCapacity<T>(
  collection: T[],
  values: readonly T[],
  label: string,
): void {
  assertWithinDurableCapacity(collection, values.length, label);
  collection.push(...values);
}

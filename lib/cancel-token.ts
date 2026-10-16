// Which party's cancel link a token belongs to. The guest's mail and the
// owner's mail carry different tokens (mig#113), so the server can tell
// who cancelled; a booking stored before that has only the guest's.

import { verifyOpaqueToken } from "@spy4x/platform/tokens"
import type { Booking } from "./types.ts"

/** `"guest"` or `"owner"` for the party whose cancel link `token` came
 *  from, or `null` when it matches neither. */
export async function cancelTokenHolder(
  booking: Pick<Booking, "cancelTokenHash" | "ownerCancelTokenHash">,
  token: string,
  secret: string,
): Promise<"guest" | "owner" | null> {
  if (await verifyOpaqueToken(token, booking.cancelTokenHash, secret)) {
    return "guest"
  }
  if (
    booking.ownerCancelTokenHash !== undefined &&
    await verifyOpaqueToken(token, booking.ownerCancelTokenHash, secret)
  ) {
    return "owner"
  }
  return null
}

// Shared types across lib/, routes/, islands/.

import type { TrustedProxyHeader } from "@spy4x/platform/rate-limit/client-ip"

export type BookingStatus = "active" | "cancelled"

export interface Booking {
  id: string
  createdAt: string // ISO 8601 UTC
  date: string // YYYY-MM-DD in host TZ
  time: string // HH:MM in host TZ
  hostTz: string
  guestName: string
  guestEmail: string
  guestTz?: string // optional, captured client-side if present
  notes?: string
  cancelTokenHash: string
  /** Hash of the cancel token in the owner's mail, made like
   *  `cancelTokenHash`. A booking stored before mig#113 has none, and a
   *  cancellation of it is recorded as the guest's. */
  ownerCancelTokenHash?: string
  status: BookingStatus
  cancelledAt?: string
  cancelledBy?: "owner" | "guest"
  cancelledReason?: string
}

export type DayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN"

export interface TimeRange {
  startMin: number // minutes since midnight, host-local
  endMin: number
}

export type Availability = Record<DayOfWeek, TimeRange[]>

export interface Config {
  hostName: string
  hostEmail: string
  hostTz: string
  meetingUrl: string
  publicUrl: string
  weeklyAvailability: Availability
  slotDurationMin: number
  minNoticeHours: number
  bookingHorizonDays: number
  blockedDates: Set<string> // YYYY-MM-DD strings, host-local
  rateLimitPer5Min: number
  /** The one proxy header the rate limiter reads the client's address
   *  from (`TRUSTED_PROXY_HEADER`). Absent: no header is trusted, and
   *  the socket address is the client's address. */
  trustedProxyHeader?: TrustedProxyHeader
  theme: "light" | "dark" | "auto"
  smtp: {
    host: string
    port: number
    user: string
    pass: string
    from: string
    /** `SMTP_ALLOW_PLAINTEXT`: send without TLS when the relay offers
     *  no STARTTLS. Absent counts as false: STARTTLS is required on
     *  every port but 465, which uses implicit TLS. */
    allowPlaintext?: boolean
  }
  /** The owner's CalDAV calendar (`CALDAV_*`, mig#139), where each
   *  booking is written as an event. Absent: no calendar is written. */
  caldav?: {
    /** The calendar collection's full URL. */
    calendarUrl: string
    username: string
    password: string
  }
  cancelSecret: string
  port: number
  dataPath: string
  hideBranding: boolean
  githubUrl: string
  /** Build identifier (git short SHA, semver, etc.). Empty/undefined
   *  falls back to "dev" so the footer chip always has something to
   *  display without conditional logic in the template. */
  version: string
}

// The shared `{ ok, value } | { ok, error }` shape and its helpers.
export { err, ok, type Result } from "@spy4x/platform/universal/result"

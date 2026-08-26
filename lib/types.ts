// Shared types across lib/, routes/, islands/.

export type BookingStatus = "active" | "cancelled";

export interface Booking {
  id: string;
  createdAt: string; // ISO 8601 UTC
  date: string; // YYYY-MM-DD in host TZ
  time: string; // HH:MM in host TZ
  hostTz: string;
  guestName: string;
  guestEmail: string;
  guestTz?: string; // optional, captured client-side if present
  notes?: string;
  cancelTokenHash: string;
  status: BookingStatus;
  cancelledAt?: string;
  cancelledBy?: "owner" | "guest";
  cancelledReason?: string;
}

export type DayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface TimeRange {
  startMin: number; // minutes since midnight, host-local
  endMin: number;
}

export type Availability = Record<DayOfWeek, TimeRange[]>;

export interface Config {
  hostName: string;
  hostEmail: string;
  hostTz: string;
  meetingUrl: string;
  publicUrl: string;
  weeklyAvailability: Availability;
  slotDurationMin: number;
  minNoticeHours: number;
  bookingHorizonDays: number;
  blockedDates: Set<string>; // YYYY-MM-DD strings, host-local
  rateLimitPer5Min: number;
  theme: "light" | "dark" | "auto";
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  cancelSecret: string;
  port: number;
  dataPath: string;
  hideFooter: boolean;
  githubUrl: string;
}

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

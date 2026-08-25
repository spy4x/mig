// Shared Zod validators for API endpoints.

import { z } from "zod";

export const BookingSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(100),
  email: z.string().trim().toLowerCase().email("Please enter a valid email."),
  notes: z.string().max(500, "Notes must be 500 characters or less."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bad date format."),
  slot: z.string().regex(/^\d{2}:\d{2}$/, "Bad time format."),
  website: z.string(), // honeypot — must always be present
});

"use client";
import { createAuthClient } from "better-auth/react";

/** Same-origin auth client (baseURL defaults to the current origin). Only used when authentication is enabled. */
export const authClient = createAuthClient();

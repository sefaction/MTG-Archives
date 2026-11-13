import "server-only";
import { cache } from "react";
import { getCurrentUser } from "./auth";
import { getUnreadNotificationCount } from "./notifications";

// React discards this cache after each server render. Actions and route handlers
// continue to use the uncached authorization helpers in auth.ts.
export const getRenderUser = cache(getCurrentUser);
export const getRenderUnreadCount = cache(getUnreadNotificationCount);

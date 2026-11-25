// portal/mentor/access.js
//
// Who can use the mentor portal while it's being built (Nathan, 25 Nov 2026):
// Nathan and Michaela (staff role "admin") plus Barney, who helps build it.
// Barney's staff role stays "coach" so nothing changes for him anywhere
// else in the seminar portal or programming; he is listed here instead.
//
// Used by the page lock (gate.js), the portal menus (menu.js, switch.js)
// and the server (netlify/functions/mentor-calendar.mjs), so all four agree.

export const BUILD_TEAM = [
  "e0cb29c8-fe63-4028-aac7-47258536b98a", // Barney Linssen
];

export function canUseMentor(staff) {
  return !!staff && staff.active !== false && (staff.role === "admin" || BUILD_TEAM.includes(staff.id));
}

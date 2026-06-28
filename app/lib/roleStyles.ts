// Color styling for role badges — used in Settings and the sidebar.
// Subtle dark-tinted backgrounds with a matching text color.
export function roleBadgeStyle(role: string): { bg: string; color: string } {
  switch (role) {
    case "Founder":
      return { bg: "#422006", color: "#fcd34d" };   // gold
    case "Strategist":
      return { bg: "#172554", color: "#93c5fd" };   // blue
    case "Editor":
      return { bg: "#052e16", color: "#4ade80" };   // green
    case "Media Buyer":
      return { bg: "#3b0764", color: "#d8b4fe" };   // purple
    case "Graphic Designer":
      return { bg: "#042f2e", color: "#5eead4" };   // teal
    default:
      return { bg: "var(--raised)", color: "var(--text-secondary)" };
  }
}
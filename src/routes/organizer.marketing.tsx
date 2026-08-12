import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/organizer/marketing")({
  component: OrganizerMarketingLayout,
});

function OrganizerMarketingLayout() {
  return <Outlet />;
}

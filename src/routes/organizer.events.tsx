import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/organizer/events")({
  component: OrganizerEventsLayout,
});

function OrganizerEventsLayout() {
  return <Outlet />;
}

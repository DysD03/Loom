import { DashboardCreate } from "@/components/dashboards/dashboard-create";
import { DashboardList } from "@/components/dashboards/dashboard-list";
import { DashboardView } from "@/components/dashboards/dashboard-view";
import { getDashboard, listDashboards, loadSpec } from "@/lib/dashboards";
import { listEditorDocuments } from "@/lib/editor";

export const dynamic = "force-dynamic";

export default async function DashboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { d } = await searchParams;
  const rows = listDashboards();
  const active = d ? getDashboard(d) : undefined;

  return (
    <div className="flex h-full">
      <DashboardList
        dashboards={rows.map((row) => ({ id: row.id, title: row.title }))}
        activeId={active?.id}
      />
      {active ? (
        <DashboardView
          key={active.id}
          dashboard={{
            id: active.id,
            title: active.title,
            sourceMarkdown: active.sourceMarkdown,
            sourceName: active.sourceName,
            generatedBy: active.generatedBy,
            model: active.model,
            error: active.error,
          }}
          spec={loadSpec(active)}
        />
      ) : (
        <DashboardCreate
          editorDocs={listEditorDocuments().map((doc) => ({ id: doc.id, title: doc.title }))}
        />
      )}
    </div>
  );
}

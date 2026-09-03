import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-transparent text-white">
      <AppSidebar />
      <AppHeader />
      <main className="px-4 py-6 sm:px-6 lg:ml-[292px] lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1680px]">{children}</div>
      </main>
    </div>
  );
}

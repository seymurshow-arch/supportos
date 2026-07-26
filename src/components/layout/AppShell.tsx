import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <AppSidebar />
      <AppHeader />

      <main className="px-6 py-6 lg:ml-[280px]">
        {children}
      </main>
    </div>
  );
}
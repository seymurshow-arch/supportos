export default function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#070A12]/80 px-6 py-4 backdrop-blur-xl lg:ml-[280px]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-cyan-300">
            SupportOS
          </div>
          <h1 className="mt-1 text-xl font-semibold text-white">
            Internal Support Command Platform
          </h1>
        </div>

        <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/60">
          v2 Foundation
        </div>
      </div>
    </header>
  );
}
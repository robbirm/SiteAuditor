/** Shared skeleton for every app page while server data loads. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-7 space-y-3">
        <div className="skeleton h-8 w-72" />
        <div className="skeleton h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3 bg-surface px-5 py-5">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-8 w-16" />
            <div className="skeleton h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
            <div className="skeleton h-4 w-32" />
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="skeleton h-10 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
